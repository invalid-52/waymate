import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { INITIAL_USERS, INITIAL_VEHICLES, INITIAL_RIDES, INITIAL_BOOKINGS, INITIAL_RIDE_REQUESTS, INITIAL_REVIEWS, INITIAL_LENDING, INITIAL_WALLETS, INITIAL_WALLET, INITIAL_NOTIFICATIONS, INITIAL_EVENTS, BASE_PLATFORM_STATS } from '../src/types/data.js';

const app = express();
const port = Number(process.env.PORT || 5000);
const mongoUri = process.env.MONGODB_URI;
const jwtSecret = process.env.JWT_SECRET;
const clientOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const appEnv = process.env.NODE_ENV || 'development';
let databaseInitPromise;
mongoose.connection.on('disconnected', () => { databaseInitPromise = null; });

async function ensureDatabase() {
  if (mongoose.connection.readyState === 1) return;
  if (!databaseInitPromise) {
    databaseInitPromise = (async () => {
      if (!mongoUri) throw new Error('MONGODB_URI is required. Configure it in Vercel Environment Variables.');
      if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters.');
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 });
      const state = await State.findOne({ key: 'community' });
      if (!state) {
        try { await State.create({ key: 'community', data: initialState(), updatedAt: new Date() }); }
        catch (err) { if (err?.code !== 11000) throw err; }
      }
      // Demo users are created only if absent; existing accounts are never overwritten.
      for (const demo of INITIAL_USERS) {
        const existing = await User.findOne({ $or: [{ email: demo.email.toLowerCase() }, { username: demo.username.toLowerCase() }] }).select('_id').lean();
        if (!existing) {
          const { passwordHash: _legacyHash, ...profile } = demo;
          await User.create({
            username: demo.username.toLowerCase(), email: demo.email.toLowerCase(),
            collegeId: String(demo.collegeId || demo.generatedUserId).toUpperCase(),
            passwordHash: await bcrypt.hash(`Waymate@${demo.generatedUserId.replace('WM-', '')}`, 12),
            profile, emailVerified: true
          });
        }
      }
    })().catch(err => { databaseInitPromise = null; throw err; });
  }
  await databaseInitPromise;
}

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (clientOrigins.includes(origin) || clientOrigins.includes('*')) return callback(null, true);
    if (clientOrigins.length === 0 && appEnv !== 'production') return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS. Check CLIENT_ORIGIN in Vercel Environment Variables.'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

// Vercel serverless functions may be cold-started; reuse the Mongoose connection within each warm instance.
app.use(async (_req, _res, next) => {
  try { await ensureDatabase(); next(); }
  catch (err) { next(err); }
});

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, lowercase: true, trim: true, unique: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  collegeId: { type: String, required: true, uppercase: true, trim: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  profile: { type: mongoose.Schema.Types.Mixed, required: true },
  emailVerified: { type: Boolean, default: false },
  verificationHash: { type: String, select: false },
  verificationExpiresAt: { type: Date, select: false },
  verificationAttempts: { type: Number, default: 0 },
  verificationSentAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true, minimize: false });
const User = mongoose.models.WaymateUser || mongoose.model('WaymateUser', UserSchema);

const StateSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
}, { minimize: false });
const State = mongoose.models.WaymateState || mongoose.model('WaymateState', StateSchema);

function initialState() {
  const users = INITIAL_USERS.map(({ passwordHash, ...u }) => ({ ...u }));
  return {
    user: null, users, vehicles: INITIAL_VEHICLES, rides: INITIAL_RIDES,
    wallets: INITIAL_WALLETS, wallet: { balance: 0, thisMonthEarned: 0, thisMonthUsed: 0, transactions: [] },
    bookings: INITIAL_BOOKINGS, rideRequests: INITIAL_RIDE_REQUESTS, reviews: INITIAL_REVIEWS,
    lending: INITIAL_LENDING, notifications: INITIAL_NOTIFICATIONS, events: INITIAL_EVENTS,
    platformStats: { ...BASE_PLATFORM_STATS, members: users.length }
  };
}
const safeUser = (doc) => {
  const profile = doc.profile || {};
  return { ...profile, id: profile.id || String(doc._id), username: doc.username, email: doc.email, collegeId: doc.collegeId,
    isVerified: Boolean(doc.emailVerified), verificationStatus: doc.emailVerified ? 'VERIFIED' : 'PENDING',
    verificationStep: doc.emailVerified ? 'VERIFIED' : 'PENDING' };
};
function issueToken(user) {
  return jwt.sign({ sub: String(user._id), email: user.email }, jwtSecret, { expiresIn: '7d', issuer: 'waymate-api', audience: 'waymate-client' });
}
async function sendVerificationEmail(email, code) {
  const { BREVO_API_KEY, EMAIL_FROM, EMAIL_FROM_NAME = 'Waymate' } = process.env;
  if (!BREVO_API_KEY || !EMAIL_FROM) return false;
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM },
      to: [{ email }],
      subject: 'Verify your Waymate email',
      textContent: `Your Waymate verification code is ${code}. It expires in 10 minutes. If you did not create a Waymate account, you can ignore this email.`,
      htmlContent: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2>Verify your Waymate email</h2><p>Enter this code in Waymate to verify your email address:</p><p style="font-size:30px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. If you did not create a Waymate account, you can ignore this email.</p></div>`
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Brevo email API failed:', response.status, detail.slice(0, 500));
    throw new Error(`Brevo email delivery failed (${response.status}). Check sender verification, API key permissions, and Brevo account status.`);
  }
  return true;
}
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Please log in to continue.' });
  try {
    req.auth = jwt.verify(token, jwtSecret, { issuer: 'waymate-api', audience: 'waymate-client' });
    next();
  } catch { return res.status(401).json({ error: 'Your session expired. Please log in again.' }); }
}
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.get('/api/health', async (_req, res) => {
  res.status(200).json({ ok: true, service: 'waymate-api', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', time: new Date().toISOString() });
});
app.get('/api/app/public', async (_req, res, next) => {
  try {
    const stateDoc = await State.findOne({ key: 'community' }).lean();
    const data = stateDoc?.data || initialState();
    data.users = (data.users || []).map(user => {
      if (String(user.id || '').startsWith('user-demo-')) return user;
      const { email, phone, collegeId, ...publicProfile } = user;
      return publicProfile;
    });
    data.user = null;
    res.json({ success: true, bootstrap: data });
  } catch (e) { next(e); }
});
app.get('/api/app/bootstrap', authRequired, async (req, res, next) => {
  try {
    const [stateDoc, userDoc] = await Promise.all([
      State.findOne({ key: 'community' }).lean(),
      User.findById(req.auth.sub).lean()
    ]);
    if (!userDoc) return res.status(401).json({ error: 'Account not found.' });
    const data = stateDoc?.data || initialState();
    const profile = safeUser(userDoc);
    data.user = profile;
    data.users = [...(data.users || []).filter(u => u.id !== profile.id && u.email !== profile.email), profile];
    data.wallets ||= {};
    data.wallets[profile.id] ||= { balance: 100, thisMonthEarned: 100, thisMonthUsed: 0, transactions: [] };
    data.wallet = data.wallets[profile.id];
    res.json({ success: true, bootstrap: data, user: profile });
  } catch (e) { next(e); }
});
app.post('/api/auth/signup', async (req, res, next) => {
  try {
    const { username, fullName, registrationNumber, email, phone, password, college, pgArea, hasVehicle, vehicleModel, vehicleColour, vehicleRegistration, fuelType, isEv, avatar } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedReg = String(registrationNumber || '').trim().toUpperCase();
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) return res.status(400).json({ error: 'Username must be 3–24 characters and use letters, numbers or underscores.' });
    if (!String(fullName || '').trim() || !normalizedReg || !emailPattern.test(normalizedEmail)) return res.status(400).json({ error: 'Please complete all required identity fields with a valid email.' });
    if (String(phone || '').replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Enter a valid mobile number.' });
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (hasVehicle && (!String(vehicleModel || '').trim() || !String(vehicleRegistration || '').trim())) return res.status(400).json({ error: 'Vehicle model and registration are required.' });
    const existing = await User.findOne({ $or: [{ email: normalizedEmail }, { username: normalizedUsername }, { collegeId: normalizedReg }] }).lean();
    if (existing) return res.status(409).json({ error: existing.email === normalizedEmail ? 'That email is already registered. Try logging in instead.' : existing.username === normalizedUsername ? 'That username is already taken.' : 'That registration number is already registered.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const displayName = String(fullName).trim();
    const profile = {
      generatedUserId: `WM-${1000 + (await User.countDocuments()) + 1}`, username: normalizedUsername, name: displayName,
      phone: String(phone).trim(), college: String(college || 'PVP Siddhartha Institute of Technology').trim(),
      community: String(college || 'PVP Siddhartha Institute of Technology').trim(), pgArea: String(pgArea || 'Campus Area').trim(),
      role: hasVehicle ? 'Provider + Passenger' : 'Passenger Account',
      avatar: typeof avatar === 'string' && avatar.startsWith('data:image/') && avatar.length < 700000 ? avatar : `/avatars/demo-user-01.jpg`,
      trustLevel: 'New Member', rating: 0, reviewsCount: 0, ridesCompleted: 0, ridesShared: 0,
      vehicle: hasVehicle ? String(vehicleModel).trim() : 'No vehicle registered', vehicleModel: hasVehicle ? String(vehicleModel).trim() : '',
      bikeNumber: hasVehicle ? String(vehicleRegistration).trim().toUpperCase() : '', bikeColour: hasVehicle ? String(vehicleColour || '').trim() : '',
      fuelType: hasVehicle ? (isEv ? 'Electric' : (fuelType || 'Petrol')) : '', isEv: Boolean(hasVehicle && isEv),
      availableForLending: false, reliabilityScore: 'New member', mutualConnections: 0, collegeDomain: normalizedEmail.split('@')[1],
      walletBalance: 100, createdAt: Date.now()
    };
    const user = await User.create({ username: normalizedUsername, email: normalizedEmail, collegeId: normalizedReg, passwordHash, profile, emailVerified: false, verificationHash: crypto.createHash('sha256').update(code).digest('hex'), verificationExpiresAt: new Date(Date.now() + 10 * 60 * 1000), verificationSentAt: new Date() });
    let emailSent = false;
    try { emailSent = await sendVerificationEmail(normalizedEmail, code); } catch (err) { console.error('Verification email delivery failed:', err.message); }
    const publicUser = safeUser(user);
    const stateDoc = await State.findOne({ key: 'community' }).lean();
    const state = stateDoc?.data || initialState();
    state.users = [...(state.users || []).filter(u => u.email !== normalizedEmail), publicUser];
    state.wallets ||= {};
    state.wallets[publicUser.id] = { balance: 100, thisMonthEarned: 100, thisMonthUsed: 0, transactions: [{ id: `tx-welcome-${Date.now()}`, type: 'EARNED', amount: 100, description: 'Welcome to Waymate community credits', date: 'Just now', timestamp: Date.now() }] };
    state.platformStats = { ...(state.platformStats || BASE_PLATFORM_STATS), members: state.users.length };
    await State.findOneAndUpdate({ key: 'community' }, { $set: { data: state, updatedAt: new Date() } }, { upsert: true, new: true });
    const payload = { success: true, user: publicUser, wallet: state.wallets[publicUser.id], requiresVerification: true, emailSent };
    if (appEnv !== 'production' && !emailSent) payload.developmentVerificationCode = code;
    return res.status(201).json(payload);
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ error: 'Email, username, or registration number is already registered.' });
    next(e);
  }
});
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const lookup = String(req.body?.emailOrUserId || req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!lookup || !password) return res.status(400).json({ error: 'Enter your email/Waymate ID and password.' });
    const user = await User.findOne({ $or: [{ email: lookup }, { username: lookup }, { 'profile.generatedUserId': lookup.toUpperCase() }] }).select('+passwordHash').lean();
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    if (!await bcrypt.compare(password, user.passwordHash)) return res.status(401).json({ error: 'Invalid email or password.' });
    if (!user.emailVerified) return res.status(403).json({ error: 'Please verify your email before logging in.' });
    const profile = safeUser(user);
    const stateDoc = await State.findOne({ key: 'community' }).lean();
    const state = stateDoc?.data || initialState();
    state.users = [...(state.users || []).filter(u => u.id !== profile.id && u.email !== profile.email), profile];
    state.wallets ||= {};
    state.wallets[profile.id] ||= { balance: 100, thisMonthEarned: 100, thisMonthUsed: 0, transactions: [] };
    state.platformStats = { ...(state.platformStats || BASE_PLATFORM_STATS), members: state.users.length };
    await State.findOneAndUpdate({ key: 'community' }, { $set: { data: state, updatedAt: new Date() } }, { upsert: true });
    res.json({ success: true, user: profile, wallet: state.wallets[profile.id], token: issueToken(user) });
  } catch (e) { next(e); }
});
app.post('/api/auth/verify', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.otp || '').trim();
    if (!emailPattern.test(email) || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter your email and 6-digit verification code.' });
    const user = await User.findOne({ email }).select('+verificationHash +verificationExpiresAt');
    if (!user) return res.status(400).json({ error: 'Invalid or expired verification code.' });
    if (user.verificationAttempts >= 8) return res.status(429).json({ error: 'Too many verification attempts. Request a new code.' });
    user.verificationAttempts += 1;
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    if (!user.verificationHash || !user.verificationExpiresAt || user.verificationExpiresAt < new Date() || hash !== user.verificationHash) {
      await user.save();
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }
    user.emailVerified = true; user.verificationHash = undefined; user.verificationExpiresAt = undefined; user.verificationAttempts = 0;
    await user.save();
    const profile = safeUser(user);
    const stateDoc = await State.findOne({ key: 'community' }).lean();
    const state = stateDoc?.data || initialState();
    state.users = [...(state.users || []).filter(u => u.id !== profile.id && u.email !== profile.email), profile];
    state.platformStats = { ...(state.platformStats || BASE_PLATFORM_STATS), members: state.users.length };
    await State.findOneAndUpdate({ key: 'community' }, { $set: { data: state, updatedAt: new Date() } }, { upsert: true });
    res.json({ success: true, user: profile, token: issueToken(user) });
  } catch (e) { next(e); }
});
app.post('/api/auth/resend-verification', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user || user.emailVerified) return res.json({ success: true, message: 'If the account is pending verification, a new code will be sent.' });
    if (user.verificationSentAt && Date.now() - new Date(user.verificationSentAt).getTime() < 60 * 1000) {
      return res.status(429).json({ error: 'Please wait one minute before requesting another verification code.' });
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    user.verificationHash = crypto.createHash('sha256').update(code).digest('hex');
    user.verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000); user.verificationSentAt = new Date(); user.verificationAttempts = 0;
    await user.save();
    let emailSent = false; try { emailSent = await sendVerificationEmail(email, code); } catch (err) { console.error('Verification resend failed:', err.message); }
    const payload = { success: true, emailSent };
    if (appEnv !== 'production' && !emailSent) payload.developmentVerificationCode = code;
    res.json(payload);
  } catch (e) { next(e); }
});
app.post('/api/auth/logout', (_req, res) => res.json({ success: true }));
app.post('/api/user/verify', (_req, res) => {
  res.status(410).json({ error: 'Use the email verification code flow at /api/auth/verify.' });
});
app.get('/api/state', authRequired, async (_req, res, next) => {
  try {
    const state = await State.findOne({ key: 'community' }).lean();
    res.json({ success: true, data: state?.data || initialState() });
  } catch (e) { next(e); }
});
app.put('/api/state', authRequired, async (req, res, next) => {
  try {
    const data = req.body?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'A valid application state is required.' });
    // Preserve server-owned account identity and credentials; client can sync community operations only.
    const current = await State.findOne({ key: 'community' }).lean();
    const existing = current?.data || initialState();
    const incomingUsers = Array.isArray(data.users) ? data.users : existing.users;
    const sanitizedUsers = incomingUsers.map(({ passwordHash, ...u }) => u);
    const safeData = {
      ...existing,
      ...data,
      users: sanitizedUsers,
      user: null,
      updatedAt: Date.now()
    };
    await State.findOneAndUpdate({ key: 'community' }, { $set: { data: safeData, updatedAt: new Date() } }, { upsert: true });
    res.json({ success: true, updatedAt: new Date().toISOString() });
  } catch (e) { next(e); }
});
app.patch('/api/user/profile', authRequired, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.sub);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    const allowed = ['name','phone','college','pgArea','avatar','vehicleModel','bikeColour','isEv'];
    for (const key of allowed) if (req.body?.[key] !== undefined) user.profile[key] = req.body[key];
    user.markModified('profile');
    await user.save();
    res.json({ success: true, user: safeUser(user) });
  } catch (e) { next(e); }
});
app.use((err, _req, res, _next) => {
  console.error('Waymate API error:', err?.message || 'Unknown error');
  if (res.headersSent) return;
  res.status(500).json({ error: 'The server could not complete the request. Check backend configuration and logs.' });
});

export default app;

// Local development only. Vercel imports the Express app through api/[...path].js.
if (process.env.VERCEL !== '1') {
  const port = Number(process.env.PORT || 5000);
  ensureDatabase()
    .then(() => app.listen(port, '0.0.0.0', () => console.log(`[Waymate API] listening on port ${port}; MongoDB connected.`)))
    .catch(err => { console.error('[Waymate API startup failed]', err.message); process.exit(1); });
}
