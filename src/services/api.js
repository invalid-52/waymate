// Realistic Frontend API Service Layer for Waymate
// Models realistic HTTP/REST transactions, persistent storage, offline detection, and idempotency guards.
// Supports local demo mode and optional remote Waymate API persistence.

import {
  INITIAL_USER,
  INITIAL_USERS,
  INITIAL_VEHICLES,
  INITIAL_RIDES,
  INITIAL_WALLETS,
  INITIAL_WALLET,
  INITIAL_BOOKINGS,
  INITIAL_RIDE_REQUESTS,
  INITIAL_REVIEWS,
  INITIAL_LENDING,
  INITIAL_NOTIFICATIONS,
  INITIAL_EVENTS,
  BASE_PLATFORM_STATS,
  DEMO_PASSWORD_FALLBACK_HASH
} from '../types/data.js';
import { calculateTrustLevel } from './seedService.js';
import { getStorage, setStorage, removeStorage } from './storage.js';

const STORAGE_KEY = 'waymate_db_v1';
const LEGACY_STORAGE_KEY = 'fellowride_db_v1';
const OFFLINE_KEY = 'waymate_simulated_offline';
const SESSION_KEY = 'waymate_session_v1';

const DEMO_USER_IDS = new Set(INITIAL_USERS.map(u => u.id));
const DEMO_WAYMATE_IDS = new Set(INITIAL_USERS.map(u => u.generatedUserId));

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
export const remoteApiEnabled = Boolean(import.meta.env.VITE_API_BASE_URL);

const remoteRequest = async (path, options = {}) => {
  const session = getSession();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(body.error || body.message || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return body;
};

export const requestVerificationCode = async (email) => remoteRequest('/auth/resend-verification', {
  method: 'POST', body: JSON.stringify({ email })
});

export const hydrateRemoteDatabase = async () => {
  if (!remoteApiEnabled) return null;
  const session = getSession();
  const response = session?.token
    ? await remoteRequest('/app/bootstrap')
    : await remoteRequest('/app/public', { headers: {} });
  const data = response.bootstrap;
  if (!data) return null;
  if (session?.userId && session.token && response.user) {
    data.user = response.user;
    data.wallets ||= {};
    data.wallet ||= data.wallets[response.user.id] || { balance: response.user.walletBalance || 100, thisMonthEarned: 0, thisMonthUsed: 0, transactions: [] };
  } else {
    data.user = null;
    data.wallet = { balance: 0, thisMonthEarned: 0, thisMonthUsed: 0, transactions: [] };
  }
  saveDatabase(data);
  return data;
};

// Helper to simulate realistic async network round-trip (100ms - 220ms)
const simulateNetworkDelay = () => {
  const delay = Math.floor(Math.random() * 120) + 100;
  return new Promise(resolve => setTimeout(resolve, delay));
};

// Check actual browser online status or manual test toggle
export const isNetworkAvailable = () => {
  if (typeof window === 'undefined') return true;
  const isSimulatedOffline = localStorage.getItem(OFFLINE_KEY) === 'true';
  return navigator.onLine && !isSimulatedOffline;
};

export const setSimulatedOfflineMode = (offline) => {
  setStorage(OFFLINE_KEY, offline ? 'true' : 'false');
  window.dispatchEvent(new Event('waymate_offline_change'));
};

export const getSimulatedOfflineMode = () => {
  return getStorage(OFFLINE_KEY) === 'true';
};

// In-flight mutations cache for double-submit prevention
const activeMutations = new Set();

// Load or initialize persistent database
export const loadDatabase = () => {
  try {
    const raw = getStorage(STORAGE_KEY) || getStorage(LEGACY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.users && parsed.users.length >= 9) {
        // Ensure per-user wallets exist
        parsed.wallets ||= { ...INITIAL_WALLETS };
        for (const [id, w] of Object.entries(INITIAL_WALLETS)) {
          if (!parsed.wallets[id]) parsed.wallets[id] = w;
        }

        // Ensure notifications exist
        parsed.notifications ||= [...INITIAL_NOTIFICATIONS];

        // Ensure active user is strictly resolved from session
        const session = getSession();
        if (session?.userId) {
          const currentLoggedIn = parsed.users.find(u => u.id === session.userId);
          if (currentLoggedIn) {
            parsed.user = currentLoggedIn;
            parsed.wallet = parsed.wallets[currentLoggedIn.id] || {
              balance: currentLoggedIn.walletBalance || 50,
              thisMonthEarned: 0,
              thisMonthUsed: 0,
              transactions: []
            };
          } else {
            parsed.user = null;
            parsed.wallet = { balance: 0, thisMonthEarned: 0, thisMonthUsed: 0, transactions: [] };
          }
        } else {
          // No session -> landing / guest mode
          parsed.user = null;
          parsed.wallet = { balance: 0, thisMonthEarned: 0, thisMonthUsed: 0, transactions: [] };
        }

        parsed.reviews ||= INITIAL_REVIEWS;
        parsed.rideRequests ||= INITIAL_RIDE_REQUESTS;
        parsed.vehicles ||= INITIAL_VEHICLES;
        parsed.events ||= INITIAL_EVENTS;
        parsed.lending ||= INITIAL_LENDING;
        parsed.platformStats ||= { ...BASE_PLATFORM_STATS, members: parsed.users.length };

        saveDatabase(parsed);
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to parse database from localStorage, resetting to seeds', err);
  }

  // Construct initial connected database with 9 demo users
  const seededUsers = INITIAL_USERS.map(u => {
    const trust = calculateTrustLevel(u, INITIAL_REVIEWS);
    return {
      ...u,
      rating: trust.rating,
      reviewsCount: trust.reviewsCount,
      trustLevel: trust.trustLevel
    };
  });

  const session = getSession();
  let activeUser = null;
  let activeWallet = { balance: 0, thisMonthEarned: 0, thisMonthUsed: 0, transactions: [] };

  if (session?.userId) {
    activeUser = seededUsers.find(u => u.id === session.userId) || null;
    if (activeUser) {
      activeWallet = INITIAL_WALLETS[activeUser.id] || activeWallet;
    }
  }

  const initialDb = {
    user: activeUser,
    users: seededUsers,
    vehicles: INITIAL_VEHICLES,
    rides: INITIAL_RIDES,
    wallets: { ...INITIAL_WALLETS },
    wallet: activeWallet,
    bookings: INITIAL_BOOKINGS,
    rideRequests: INITIAL_RIDE_REQUESTS,
    reviews: INITIAL_REVIEWS,
    lending: INITIAL_LENDING,
    notifications: [...INITIAL_NOTIFICATIONS],
    events: INITIAL_EVENTS,
    platformStats: { ...BASE_PLATFORM_STATS, members: seededUsers.length },
    createdAt: Date.now()
  };

  saveDatabase(initialDb);
  return initialDb;
};

export const saveDatabase = (db) => {
  try {
    setStorage(STORAGE_KEY, JSON.stringify(db));
  } catch (err) {
    console.error('Failed to persist database to localStorage', err);
  }
};

export const resetDatabase = () => {
  removeStorage(STORAGE_KEY);
  removeStorage(LEGACY_STORAGE_KEY);
  removeStorage(OFFLINE_KEY);
  removeStorage(SESSION_KEY);
  return loadDatabase();
};

// Generic safe API runner with realistic HTTP errors & idempotency
async function apiCall(endpoint, mutationKey, handler) {
  if (!isNetworkAvailable()) {
    await new Promise(r => setTimeout(r, 120));
    const error = new Error('Network unavailable: Check your connection and try again.');
    error.name = 'OfflineError';
    error.status = 503;
    throw error;
  }

  if (mutationKey) {
    if (activeMutations.has(mutationKey)) {
      const error = new Error('A request is already in progress. Please wait.');
      error.status = 409;
      throw error;
    }
    activeMutations.add(mutationKey);
  }

  try {
    await simulateNetworkDelay();
    const db = loadDatabase();
    const result = await handler(db);
    if (remoteApiEnabled && getSession()?.token) {
      await remoteRequest('/state', { method: 'PUT', body: JSON.stringify({ data: db }) });
    }
    saveDatabase(db);
    return result;
  } finally {
    if (mutationKey) {
      activeMutations.delete(mutationKey);
    }
  }
}

// -------------------------------------------------------------
// AUTHENTICATION / SESSION APIs
// -------------------------------------------------------------

export const getSession = () => {
  try {
    const raw = getStorage(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const clearSession = () => {
  removeStorage(SESSION_KEY);
};

export const apiSignUp = async ({
  username,
  fullName,
  registrationNumber,
  email,
  phone,
  password,
  college,
  pgArea,
  hasVehicle,
  vehicleModel,
  vehicleColour,
  vehicleRegistration,
  fuelType,
  isEv,
  avatar
}) => {
  if (remoteApiEnabled) {
    const result = await remoteRequest('/auth/signup', { method: 'POST', body: JSON.stringify({ username, fullName, registrationNumber, email, phone, password, college, pgArea, hasVehicle, vehicleModel, vehicleColour, vehicleRegistration, fuelType, isEv, avatar }) });
    const db = loadDatabase();
    const user = result.user;
    db.users = [...(db.users || []).filter(u => u.email?.toLowerCase() !== user.email.toLowerCase()), user];
    // Do not establish an authenticated session until the email code is verified.
    db.user = null;
    db.wallets ||= {};
    db.wallets[user.id] = result.wallet || { balance: 100, thisMonthEarned: 100, thisMonthUsed: 0, transactions: [] };
    db.wallet = { balance: 0, thisMonthEarned: 0, thisMonthUsed: 0, transactions: [] };
    db.platformStats ||= { ...BASE_PLATFORM_STATS };
    db.platformStats.members = db.users.length;
    setStorage('waymate_pending_verification_email', user.email);
    setStorage('waymate_pending_verification_sent', result.emailSent ? 'true' : 'false');
    clearSession();
    removeStorage('waymate_access_token');
    saveDatabase(db);
    return { ...result, user, wallet: db.wallet };
  }
  const { hashPassword } = await import('./auth.js');
  return apiCall('/api/auth/signup', `signup-${email.toLowerCase()}`, async db => {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedReg = (registrationNumber || '').trim().toUpperCase();

    if (db.users.some(item => item.email?.toLowerCase() === normalizedEmail)) {
      const err = new Error('That email is already registered. Try logging in instead.');
      err.status = 409;
      throw err;
    }
    if (db.users.some(item => item.username?.toLowerCase() === normalizedUsername)) {
      const err = new Error('That username is already taken.');
      err.status = 409;
      throw err;
    }
    if (normalizedReg && db.users.some(item => item.collegeId?.toUpperCase() === normalizedReg)) {
      const err = new Error('That registration number is already registered.');
      err.status = 409;
      throw err;
    }

    const userId = `user-${Date.now()}`;
    
    // Generate unique sequential Waymate ID: WM-1010, WM-1011, etc.
    const existingCodes = db.users
      .map(u => {
        const match = u.generatedUserId?.match(/^WM-(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(n => n > 0);
    const maxCode = existingCodes.length > 0 ? Math.max(...existingCodes) : 1009;
    const nextCode = Math.max(1010, maxCode + 1);
    const generatedUserId = `WM-${nextCode}`;

    const displayName = (fullName || username).trim();
    const userCollege = college || 'PVP Siddhartha Institute of Technology';
    const userPg = pgArea || 'Campus Area';

    // Build new user record with default UNVERIFIED / PENDING state (Sections 8, 10, 11)
    const newUser = {
      id: userId,
      generatedUserId,
      username: normalizedUsername,
      name: displayName,
      email: normalizedEmail,
      phone: (phone || '').trim(),
      collegeId: normalizedReg,
      college: userCollege,
      community: userCollege,
      pgArea: userPg,
      role: hasVehicle ? 'Provider + Passenger' : 'Passenger Account',
      avatar: avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(displayName)}`,
      isVerified: false,
      verificationStep: 'PENDING',
      verificationStatus: 'PENDING',
      trustLevel: 'New Member',
      rating: 0,
      reviewsCount: 0,
      ridesCompleted: 0,
      ridesShared: 0,
      vehicle: hasVehicle && vehicleModel ? vehicleModel.trim() : 'No vehicle registered',
      vehicleModel: hasVehicle && vehicleModel ? vehicleModel.trim() : '',
      bikeNumber: hasVehicle && vehicleRegistration ? vehicleRegistration.trim().toUpperCase() : '',
      bikeColour: hasVehicle && vehicleColour ? vehicleColour.trim() : '',
      fuelType: hasVehicle ? (isEv ? 'Electric' : (fuelType || 'Petrol')) : '',
      isEv: Boolean(hasVehicle && isEv),
      availableForLending: false,
      reliabilityScore: 'New member',
      mutualConnections: 0,
      collegeDomain: normalizedEmail.split('@')[1] || 'waymate.app',
      passwordHash: await hashPassword(password),
      createdAt: Date.now(),
      walletBalance: 100
    };

    // If user has a vehicle, register vehicle record in db.vehicles
    if (hasVehicle && vehicleModel) {
      const newVehicle = {
        id: `veh-${Date.now()}`,
        ownerId: userId,
        vehicleType: 'Two Wheeler',
        brand: vehicleModel.split(' ')[0] || 'Generic',
        model: vehicleModel.trim(),
        registrationNumber: vehicleRegistration ? vehicleRegistration.trim().toUpperCase() : 'AP 16 TEMP',
        vehicleColour: vehicleColour ? vehicleColour.trim() : 'Standard',
        fuelType: isEv ? 'Electric' : (fuelType || 'Petrol'),
        isEv: Boolean(isEv),
        seats: 1,
        availableForLending: false,
        isAvailable: true
      };
      db.vehicles.push(newVehicle);
    }

    // Initialize per-user wallet with 100 initial credits (Section 12)
    const newWallet = {
      balance: 100,
      thisMonthEarned: 100,
      thisMonthUsed: 0,
      transactions: [
        {
          id: `tx-welcome-${Date.now()}`,
          type: 'EARNED',
          amount: 100,
          description: 'Welcome to Waymate community credits',
          date: 'Just now',
          timestamp: Date.now()
        }
      ]
    };

    db.wallets ||= {};
    db.wallets[userId] = newWallet;
    db.wallet = newWallet;
    db.users.push(newUser);
    db.user = newUser;
    db.platformStats ||= { ...BASE_PLATFORM_STATS };
    db.platformStats.members = db.users.length;

    // Persist authenticated session
    setStorage(SESSION_KEY, JSON.stringify({ userId: newUser.id, loggedInAt: Date.now() }));
    return { success: true, user: newUser, wallet: newWallet, userCount: db.users.length };
  });
};

export const apiLogin = async ({ emailOrUserId, password }) => {
  if (remoteApiEnabled) {
    const result = await remoteRequest('/auth/login', { method: 'POST', body: JSON.stringify({ emailOrUserId, password }) });
    const user = result.user;
    const db = loadDatabase();
    db.users = [...(db.users || []).filter(u => u.email?.toLowerCase() !== user.email.toLowerCase()), user];
    db.user = user;
    db.wallets ||= {};
    db.wallets[user.id] = result.wallet || { balance: user.walletBalance || 100, thisMonthEarned: 0, thisMonthUsed: 0, transactions: [] };
    db.wallet = db.wallets[user.id];
    setStorage(SESSION_KEY, JSON.stringify({ userId: user.id, loggedInAt: Date.now(), token: result.token }));
    setStorage('waymate_access_token', result.token || '');
    saveDatabase(db);
    return result;
  }
  const { hashPassword } = await import('./auth.js');
  return apiCall('/api/auth/login', `login-${emailOrUserId.toLowerCase()}`, async db => {
    const lookup = emailOrUserId.trim().toLowerCase();
    const found = db.users.find(item =>
      item.email?.toLowerCase() === lookup ||
      item.generatedUserId?.toLowerCase() === lookup ||
      item.username?.toLowerCase() === lookup
    );

    if (!found) {
      const err = new Error('No Waymate account matches that email or Waymate ID.');
      err.status = 401;
      throw err;
    }

    const incomingHash = await hashPassword(password);
    const isDemo = found.id?.startsWith('user-demo-') || found.email?.endsWith('@waymate.app');
    
    // Check password hash or demo password
    let isValid = false;
    if (found.passwordHash && found.passwordHash === incomingHash) {
      isValid = true;
    } else if (isDemo) {
      const expectedPassword = `Waymate@${found.generatedUserId?.replace('WM-', '')}`;
      if (password === expectedPassword || password === 'Waymate@2026' || incomingHash === DEMO_PASSWORD_FALLBACK_HASH) {
        isValid = true;
      }
    }

    if (!isValid) {
      const err = new Error('That password does not match this account.');
      err.status = 401;
      throw err;
    }

    db.user = found;

    // Load active user's specific wallet
    db.wallets ||= { ...INITIAL_WALLETS };
    if (!db.wallets[found.id]) {
      db.wallets[found.id] = {
        balance: found.walletBalance || 100,
        thisMonthEarned: Math.round((found.walletBalance || 100) * 0.35),
        thisMonthUsed: Math.round((found.walletBalance || 100) * 0.15),
        transactions: [
          {
            id: `tx-${found.id}-welcome`,
            type: 'EARNED',
            amount: found.walletBalance || 100,
            description: 'Campus community credits',
            date: 'Just now',
            timestamp: Date.now()
          }
        ]
      };
    }
    db.wallet = db.wallets[found.id];

    setStorage(SESSION_KEY, JSON.stringify({ userId: found.id, loggedInAt: Date.now() }));
    return { success: true, user: found, wallet: db.wallet, userCount: db.users.length };
  });
};

export const apiUpdateProfile = async ({ bikeColour, isEv, vehicleModel, avatar }) => {
  if (remoteApiEnabled && getSession()?.token) {
    const result = await remoteRequest('/user/profile', { method: 'PATCH', body: JSON.stringify({ bikeColour, isEv, vehicleModel, avatar }) });
    const db = loadDatabase();
    db.user = { ...(db.user || {}), ...(result.user || {}) };
    db.users = (db.users || []).map(u => u.id === db.user.id ? { ...u, ...result.user } : u);
    saveDatabase(db);
    return { success: true, user: db.user };
  }
  return apiCall('/api/profile/update', 'profile-update', async db => {
    if (!db.user) throw new Error('Not authenticated.');
    const user = db.user;
    if (bikeColour !== undefined) user.bikeColour = bikeColour.trim();
    if (isEv !== undefined) user.isEv = Boolean(isEv);
    if (vehicleModel !== undefined) {
      user.vehicleModel = vehicleModel.trim();
      user.vehicle = vehicleModel.trim() || user.vehicle;
    }
    if (avatar) user.avatar = avatar;

    const inList = db.users.find(u => u.id === user.id);
    if (inList) Object.assign(inList, user);

    return { success: true, user };
  });
};

export const apiCreateEvent = async eventData => apiCall('/api/events/create', `event-${Date.now()}`, async db => {
  const event = {
    id: `event-${Date.now()}`,
    title: eventData.title.trim(),
    date: eventData.date,
    time: eventData.time,
    location: eventData.location.trim(),
    demand: eventData.demand || 'Moderate',
    expectedDemand: Number(eventData.expectedDemand || 10),
    attendees: Number(eventData.attendees || 80),
    createdAt: Date.now()
  };
  db.events.unshift(event);
  return { success: true, event };
});

export const apiLogout = () => {
  if (remoteApiEnabled && getSession()?.token) {
    remoteRequest('/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
  }
  clearSession();
  removeStorage('waymate_access_token');
  const db = loadDatabase();
  db.user = null;
  db.wallet = { balance: 0, thisMonthEarned: 0, thisMonthUsed: 0, transactions: [] };
  saveDatabase(db);
  return { success: true };
};

// -------------------------------------------------------------
// CORE RIDE & BOOKING APIs (Sections 3 - 7, 36 - 38)
// -------------------------------------------------------------

export const apiVerifyUser = async ({ email, otp, inviteCode }) => {
  if (remoteApiEnabled) {
    const result = await remoteRequest('/auth/verify', { method: 'POST', body: JSON.stringify({ email, otp, inviteCode }) });
    const db = loadDatabase();
    const user = result.user;
    db.users = (db.users || []).map(item => item.id === user.id ? { ...item, ...user } : item);
    db.user = { ...(db.user || {}), ...user };
    const session = getSession() || {};
    setStorage(SESSION_KEY, JSON.stringify({ ...session, userId: user.id, token: result.token || session.token }));
    if (result.token) setStorage('waymate_access_token', result.token);
    removeStorage('waymate_pending_verification_email');
    removeStorage('waymate_pending_verification_sent');
    saveDatabase(db);
    return result;
  }
  return apiCall('/api/user/verify', 'user-verify', async (db) => {
    if (!db.user) throw new Error('Not authenticated.');
    db.user.isVerified = true;
    db.user.verificationStep = 'VERIFIED';
    db.user.verificationStatus = 'VERIFIED';
    db.user.email = email || db.user.email;
    const profile = db.users?.find(item => item.id === db.user.id);
    if (profile) {
      profile.isVerified = true;
      profile.verificationStep = 'VERIFIED';
      profile.verificationStatus = 'VERIFIED';
    }
    return { success: true, user: db.user };
  });
};

export const apiFetchRides = async (filters = {}) => {
  return apiCall('/api/rides', null, async (db) => {
    let list = [...db.rides];
    if (filters.from && filters.from.trim()) {
      const f = filters.from.toLowerCase().trim();
      list = list.filter(r => r.from.toLowerCase().includes(f));
    }
    if (filters.to && filters.to.trim()) {
      const t = filters.to.toLowerCase().trim();
      list = list.filter(r => r.to.toLowerCase().includes(t));
    }
    return list.sort((a, b) => (b.seatsAvailable > 0 ? 1 : 0) - (a.seatsAvailable > 0 ? 1 : 0));
  });
};

/**
 * Atomic Request Seat Operation (Section 3)
 * 1. Determine authenticated user.
 * 2. Determine selected ride & provider.
 * 3. Calculate ride contribution cost.
 * 4. Verify sufficient credits.
 * 5. Prevent duplicate booking.
 * 6. Deduct credits from passenger wallet.
 * 7. Create passenger credit transaction.
 * 8. Update ride available seats.
 * 9. Credit/record provider pending transaction.
 * 10. Create booking record.
 * 11. Create real notification for provider.
 * 12. Refresh and return updated entities.
 */
export const apiBookSeat = async ({ rideId, seats = 1, notes = '' }) => {
  const mutationKey = `book-${rideId}`;
  return apiCall(`/api/rides/${rideId}/book`, mutationKey, async (db) => {
    const session = getSession();
    const currentUserId = session?.userId || db.user?.id;
    if (!currentUserId) {
      const err = new Error('You must be signed in to request a seat.');
      err.status = 401;
      throw err;
    }

    const passenger = db.users.find(u => u.id === currentUserId) || db.user;
    if (!passenger) {
      const err = new Error('Passenger profile not found.');
      err.status = 404;
      throw err;
    }

    const ride = db.rides.find(r => r.id === rideId);
    if (!ride) {
      const err = new Error('Selected ride was not found.');
      err.status = 404;
      throw err;
    }

    // Check available seats
    if (ride.seatsAvailable < seats) {
      const err = new Error(`Only ${ride.seatsAvailable} seat(s) available on this ride.`);
      err.status = 400;
      throw err;
    }

    // Check duplicate booking
    const alreadyBooked = (db.bookings || []).some(
      b => b.rideId === ride.id && b.userId === passenger.id && b.status === 'UPCOMING'
    );
    if (alreadyBooked) {
      const err = new Error('You have already reserved a seat on this journey.');
      err.status = 409;
      throw err;
    }

    const totalContribution = ride.contribution * seats;
    db.wallets ||= { ...INITIAL_WALLETS };
    if (!db.wallets[passenger.id]) {
      db.wallets[passenger.id] = {
        balance: passenger.walletBalance || 100,
        thisMonthEarned: 0,
        thisMonthUsed: 0,
        transactions: []
      };
    }
    const passengerWallet = db.wallets[passenger.id];

    // Check sufficient credits (Section 5)
    if (passengerWallet.balance < totalContribution) {
      const err = new Error(
        `NOT ENOUGH COMMUNITY CREDITS. You need ${totalContribution} credits for this ride. Your balance: ${passengerWallet.balance} credits.`
      );
      err.code = 'INSUFFICIENT_CREDITS';
      err.status = 402;
      err.requiredCredits = totalContribution;
      err.currentBalance = passengerWallet.balance;
      throw err;
    }

    // Decrement ride seats
    ride.seatsAvailable -= seats;

    // Deduct passenger credits
    passengerWallet.balance -= totalContribution;
    passengerWallet.thisMonthUsed = (passengerWallet.thisMonthUsed || 0) + totalContribution;

    // Record passenger transaction
    const newTx = {
      id: `tx-${Date.now()}`,
      type: 'USED',
      amount: totalContribution,
      description: `Ride booked — ${ride.from} → ${ride.to}`,
      date: 'Just now',
      rideId: ride.id,
      timestamp: Date.now()
    };
    passengerWallet.transactions.unshift(newTx);
    db.wallet = passengerWallet;
    db.wallets[passenger.id] = passengerWallet;

    // Credit driver / provider ledger
    const providerId = ride.providerId || ride.provider?.id;
    if (providerId && db.wallets[providerId]) {
      db.wallets[providerId].balance += totalContribution;
      db.wallets[providerId].thisMonthEarned = (db.wallets[providerId].thisMonthEarned || 0) + totalContribution;
      db.wallets[providerId].transactions.unshift({
        id: `tx-earn-${Date.now()}`,
        type: 'EARNED',
        amount: totalContribution,
        description: `Shared ride contribution from ${passenger.name} (${ride.from} → ${ride.to})`,
        date: 'Just now',
        rideId: ride.id,
        timestamp: Date.now()
      });
    }

    // Create booking record
    const bookingId = `book-${Date.now()}`;
    const newBooking = {
      id: bookingId,
      rideId: ride.id,
      userId: passenger.id,
      providerId: providerId,
      type: 'PASSENGER',
      from: ride.from,
      to: ride.to,
      date: ride.date || 'Today',
      time: ride.departureTime,
      partnerName: ride.provider.name,
      partnerAvatar: ride.provider.avatar,
      partnerRole: 'Provider',
      vehicle: ride.vehicle,
      seatsBooked: seats,
      contribution: totalContribution,
      status: 'UPCOMING',
      createdAt: Date.now()
    };
    db.bookings.unshift(newBooking);

    // Create real-time notification for the provider (Section 27)
    db.notifications ||= [];
    db.notifications.unshift({
      id: `notif-${Date.now()}`,
      recipientId: providerId,
      senderId: passenger.id,
      senderName: passenger.name,
      senderAvatar: passenger.avatar,
      senderTrustLevel: passenger.trustLevel || 'New Member',
      senderRating: passenger.rating || 0,
      type: 'RIDE_BOOKED',
      title: '🔔 New ride request',
      message: `${passenger.name} requested a seat on your journey. ${ride.from} → ${ride.to} · ${ride.departureTime}`,
      bookingId: newBooking.id,
      rideId: ride.id,
      is_read: false,
      createdAt: Date.now()
    });

    // Update passenger stats
    passenger.ridesCompleted = (passenger.ridesCompleted || 0) + 1;
    passenger.walletBalance = passengerWallet.balance;
    const currentUserInUsers = db.users.find(u => u.id === passenger.id);
    if (currentUserInUsers) {
      currentUserInUsers.ridesCompleted = passenger.ridesCompleted;
      currentUserInUsers.walletBalance = passengerWallet.balance;
    }

    return {
      success: true,
      booking: newBooking,
      ride,
      wallet: passengerWallet
    };
  });
};

export const apiConfirmBooking = async (bookingId) => {
  const mutationKey = `confirm-${bookingId}`;
  return apiCall(`/api/bookings/${bookingId}/confirm`, mutationKey, async (db) => {
    const booking = db.bookings.find(b => b.id === bookingId);
    if (!booking) {
      const err = new Error('Booking not found.');
      err.status = 404;
      throw err;
    }

    booking.status = 'CONFIRMED';
    booking.confirmedAt = Date.now();

    // Send confirmation notification to passenger (Section 28)
    db.notifications ||= [];
    db.notifications.unshift({
      id: `notif-${Date.now()}`,
      recipientId: booking.userId,
      senderId: db.user.id,
      senderName: db.user.name,
      senderAvatar: db.user.avatar,
      senderTrustLevel: db.user.trustLevel || 'Trusted Member',
      senderRating: db.user.rating || 4.9,
      type: 'RIDE_CONFIRMED',
      title: '✓ Ride confirmed',
      message: `${db.user.name} confirmed your seat. ${booking.from} → ${booking.to} · ${booking.time}. Your ${booking.contribution}-credit contribution has been recorded.`,
      bookingId: booking.id,
      is_read: false,
      createdAt: Date.now()
    });

    return { success: true, booking };
  });
};

export const apiCreateRide = async (rideData) => {
  const mutationKey = `create-ride-${Date.now()}`;
  return apiCall('/api/rides/create', mutationKey, async (db) => {
    if (!db.user) throw new Error('Not authenticated.');
    const { from, to, date, departureTime, seatsTotal, vehicle, note, distanceKm, contribution } = rideData;
    const calculatedContribution = contribution || Math.max(10, Math.round((distanceKm || 4.2) * 3.2));
    const safeSeats = parseInt(seatsTotal, 10) || 1;

    const newRide = {
      id: `ride-${Date.now()}`,
      providerId: db.user.id,
      provider: {
        id: db.user.id,
        name: db.user.name,
        avatar: db.user.avatar,
        college: db.user.college || 'PVP Siddhartha Institute of Technology',
        community: db.user.community,
        isVerified: db.user.isVerified,
        rating: db.user.rating,
        ridesCompleted: db.user.ridesCompleted,
        ridesShared: db.user.ridesShared,
        vehicle: vehicle || db.user.vehicleModel || db.user.vehicle || 'Honda Activa 6G',
        vehicleColour: db.user.bikeColour || 'Matte Black',
        isEv: Boolean(db.user.isEv),
        fuelType: db.user.fuelType || (db.user.isEv ? 'Electric' : 'Petrol'),
        reliabilityScore: db.user.reliabilityScore || '99%',
        reviewsCount: db.user.reviewsCount || 0
      },
      from: from.trim(),
      to: to.trim(),
      date: date || 'Today',
      departureTime,
      seatsTotal: safeSeats,
      seatsAvailable: safeSeats,
      distanceKm: distanceKm || 4.2,
      contribution: calculatedContribution,
      vehicle: vehicle || db.user.vehicleModel || db.user.vehicle || 'Honda Activa 6G',
      vehicleColour: db.user.bikeColour || 'Matte Black',
      isEv: Boolean(db.user.isEv),
      fuelType: db.user.fuelType || (db.user.isEv ? 'Electric' : 'Petrol'),
      note: note ? note.slice(0, 400).trim() : '',
      status: 'ACTIVE',
      requestsCount: 0,
      createdAt: Date.now()
    };

    db.rides.unshift(newRide);

    const offeredBooking = {
      id: `offered-${Date.now()}`,
      rideId: newRide.id,
      userId: db.user.id,
      providerId: db.user.id,
      type: 'PROVIDER',
      from: newRide.from,
      to: newRide.to,
      date: newRide.date,
      time: newRide.departureTime,
      partnerName: 'Community Members',
      partnerAvatar: '/avatars/demo-user-01.jpg',
      partnerRole: 'Passengers',
      vehicle: newRide.vehicle,
      seatsBooked: safeSeats,
      contribution: calculatedContribution,
      status: 'OFFERED',
      createdAt: Date.now()
    };
    db.bookings.unshift(offeredBooking);

    // Notify users who requested this corridor (Section 29)
    db.notifications ||= [];
    const matchingRequests = (db.rideRequests || []).filter(
      req => req.from?.toLowerCase() === from.trim().toLowerCase() &&
             req.to?.toLowerCase() === to.trim().toLowerCase() &&
             req.requesterId !== db.user.id
    );

    for (const req of matchingRequests) {
      db.notifications.unshift({
        id: `notif-match-${Date.now()}-${req.id}`,
        recipientId: req.requesterId,
        senderId: db.user.id,
        senderName: db.user.name,
        senderAvatar: db.user.avatar,
        type: 'RIDE_AVAILABLE',
        title: '🚲 A ride is now available',
        message: `${db.user.name} is heading toward ${newRide.to} at ${newRide.departureTime}.`,
        rideId: newRide.id,
        is_read: false,
        createdAt: Date.now()
      });
    }

    db.user.ridesShared = (db.user.ridesShared || 0) + 1;
    const currentUserInUsers = db.users.find(u => u.id === db.user.id);
    if (currentUserInUsers) currentUserInUsers.ridesShared = db.user.ridesShared;

    return { success: true, ride: newRide, booking: offeredBooking };
  });
};

export const apiCancelTrip = async (bookingId) => {
  const mutationKey = `cancel-${bookingId}`;
  return apiCall(`/api/trips/${bookingId}/cancel`, mutationKey, async (db) => {
    const booking = db.bookings.find(b => b.id === bookingId);
    if (!booking) {
      const err = new Error('Trip booking not found.');
      err.status = 404;
      throw err;
    }

    if (booking.status === 'CANCELLED') {
      const err = new Error('This trip is already cancelled.');
      err.status = 400;
      throw err;
    }

    booking.status = 'CANCELLED';

    if (booking.type === 'PASSENGER') {
      const originalRide = db.rides.find(r => r.id === booking.rideId);
      if (originalRide) {
        originalRide.seatsAvailable = Math.min(originalRide.seatsTotal, originalRide.seatsAvailable + booking.seatsBooked);
      }

      db.wallets ||= { ...INITIAL_WALLETS };
      const userWallet = db.wallets[booking.userId] || db.wallet;
      userWallet.balance += booking.contribution;
      userWallet.thisMonthUsed = Math.max(0, userWallet.thisMonthUsed - booking.contribution);

      userWallet.transactions.unshift({
        id: `tx-refund-${Date.now()}`,
        type: 'EARNED',
        amount: booking.contribution,
        description: `Refund for cancelled trip (${booking.from} → ${booking.to})`,
        date: 'Just now',
        rideId: booking.rideId,
        timestamp: Date.now()
      });
      db.wallet = userWallet;

      // Notify provider of cancellation
      if (booking.providerId) {
        db.notifications ||= [];
        db.notifications.unshift({
          id: `notif-cancel-${Date.now()}`,
          recipientId: booking.providerId,
          senderId: booking.userId,
          senderName: db.user?.name || 'Passenger',
          senderAvatar: db.user?.avatar || '/avatars/demo-user-03.jpg',
          type: 'RIDE_CANCELLED',
          title: 'Ride booking cancelled',
          message: `${db.user?.name || 'Passenger'} cancelled their seat on ${booking.from} → ${booking.to}. Seat restored.`,
          bookingId: booking.id,
          is_read: false,
          createdAt: Date.now()
        });
      }
    }

    return { success: true, booking, wallet: db.wallet };
  });
};

// -------------------------------------------------------------
// CORE VEHICLE LENDING APIs & TRANSITIONS (Sections 30, 31)
// -------------------------------------------------------------

export const apiRequestVehicleLend = async (vehicleId, borrowPurpose = '') => {
  const mutationKey = `lend-req-${vehicleId}`;
  return apiCall(`/api/lending/${vehicleId}/request`, mutationKey, async (db) => {
    if (!db.user) throw new Error('Not authenticated.');
    const item = db.lending.find(l => l.id === vehicleId);
    if (!item) {
      const err = new Error('Vehicle record not found.');
      err.status = 404;
      throw err;
    }

    if (item.status !== 'AVAILABLE') {
      const err = new Error('This vehicle is currently not available for lending.');
      err.status = 400;
      throw err;
    }

    item.status = 'REQUESTED';
    item.requesterId = db.user.id;
    item.requesterName = db.user.name;
    item.requesterAvatar = db.user.avatar;
    item.requesterTrustLevel = db.user.trustLevel || 'New Member';
    item.requesterRating = db.user.rating || 0;
    item.requesterReviewsCount = db.user.reviewsCount || 0;
    item.requesterRidesCompleted = db.user.ridesCompleted || 0;
    item.requesterCollege = db.user.college || 'PVP Siddhartha Institute of Technology';
    item.requesterCommunity = db.user.community;
    item.borrowPurpose = borrowPurpose || 'College project supply pickup in city center';
    item.startTime = '6:00 PM';
    item.endTime = '9:00 PM';
    item.updatedAt = Date.now();

    // Create real notification for the vehicle owner (Section 30)
    db.notifications ||= [];
    db.notifications.unshift({
      id: `notif-lend-${Date.now()}`,
      recipientId: item.ownerId,
      senderId: db.user.id,
      senderName: db.user.name,
      senderAvatar: db.user.avatar,
      senderTrustLevel: db.user.trustLevel || 'New Member',
      senderRating: db.user.rating || 0,
      type: 'LENDING_REQUEST',
      title: '🔑 Vehicle lending request',
      message: `${db.user.name} wants to borrow your ${item.vehicle}. 6:00 PM – 9:00 PM`,
      bike_request_id: item.id,
      is_read: false,
      createdAt: Date.now()
    });

    return { success: true, vehicle: item };
  });
};

export const apiApproveVehicleLend = async (vehicleId) => {
  const mutationKey = `lend-approve-${vehicleId}`;
  return apiCall(`/api/lending/${vehicleId}/approve`, mutationKey, async (db) => {
    const item = db.lending.find(l => l.id === vehicleId);
    if (!item) {
      const err = new Error('Lending record not found.');
      err.status = 404;
      throw err;
    }
    item.status = 'APPROVED';
    item.updatedAt = Date.now();

    // Create approval notification for requester (Section 31)
    if (item.requesterId) {
      db.notifications ||= [];
      db.notifications.unshift({
        id: `notif-lend-app-${Date.now()}`,
        recipientId: item.requesterId,
        senderId: db.user.id,
        senderName: db.user.name,
        senderAvatar: db.user.avatar,
        senderTrustLevel: db.user.trustLevel || 'Highly Trusted',
        senderRating: db.user.rating || 5.0,
        type: 'LENDING_APPROVED',
        title: '✓ Vehicle request approved',
        message: `${db.user.name} approved your request for the ${item.vehicle}. 6:00 PM – 9:00 PM`,
        bike_request_id: item.id,
        is_read: false,
        createdAt: Date.now()
      });
    }

    return { success: true, vehicle: item };
  });
};

export const apiDeclineVehicleLend = async (vehicleId) => {
  const mutationKey = `lend-decline-${vehicleId}`;
  return apiCall(`/api/lending/${vehicleId}/decline`, mutationKey, async (db) => {
    const item = db.lending.find(l => l.id === vehicleId);
    if (!item) {
      const err = new Error('Lending record not found.');
      err.status = 404;
      throw err;
    }
    const previousRequesterId = item.requesterId;
    item.status = 'AVAILABLE';
    item.requesterId = null;
    item.requesterName = null;
    item.borrowPurpose = null;
    item.updatedAt = Date.now();

    if (previousRequesterId) {
      db.notifications ||= [];
      db.notifications.unshift({
        id: `notif-lend-dec-${Date.now()}`,
        recipientId: previousRequesterId,
        senderId: db.user.id,
        senderName: db.user.name,
        senderAvatar: db.user.avatar,
        type: 'LENDING_DECLINED',
        title: 'Vehicle request declined',
        message: `${db.user.name} was unable to approve your lending request for ${item.vehicle}.`,
        bike_request_id: item.id,
        is_read: false,
        createdAt: Date.now()
      });
    }

    return { success: true, vehicle: item };
  });
};

export const apiHandoverVehicleLend = async (vehicleId) => {
  const mutationKey = `lend-handover-${vehicleId}`;
  return apiCall(`/api/lending/${vehicleId}/handover`, mutationKey, async (db) => {
    const item = db.lending.find(l => l.id === vehicleId);
    if (!item) {
      const err = new Error('Lending record not found.');
      err.status = 404;
      throw err;
    }
    item.status = 'IN_USE';
    item.updatedAt = Date.now();
    return { success: true, vehicle: item };
  });
};

export const apiReturnVehicleLend = async (vehicleId) => {
  const mutationKey = `lend-return-${vehicleId}`;
  return apiCall(`/api/lending/${vehicleId}/return`, mutationKey, async (db) => {
    const item = db.lending.find(l => l.id === vehicleId);
    if (!item) {
      const err = new Error('Lending record not found.');
      err.status = 404;
      throw err;
    }
    item.status = 'COMPLETED';
    item.updatedAt = Date.now();

    // Credit owner wallet for lending contribution (+24)
    db.wallets ||= { ...INITIAL_WALLETS };
    if (item.ownerId && db.wallets[item.ownerId]) {
      db.wallets[item.ownerId].balance += 24;
      db.wallets[item.ownerId].thisMonthEarned = (db.wallets[item.ownerId].thisMonthEarned || 0) + 24;
      db.wallets[item.ownerId].transactions.unshift({
        id: `tx-lend-earn-${Date.now()}`,
        type: 'EARNED',
        amount: 24,
        description: `Lending contribution for ${item.vehicle} (${item.requesterName || 'Peer'})`,
        date: 'Just now',
        timestamp: Date.now()
      });
    }

    return { success: true, vehicle: item };
  });
};

// -------------------------------------------------------------
// NOTIFICATION APIs (Sections 25 - 35)
// -------------------------------------------------------------

export const apiFetchNotifications = async (userId) => {
  return apiCall('/api/notifications', null, async (db) => {
    const list = (db.notifications || []).filter(n => n.recipientId === userId);
    return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  });
};

export const apiMarkNotificationAsRead = async (notificationId) => {
  return apiCall(`/api/notifications/${notificationId}/read`, `read-${notificationId}`, async (db) => {
    const notif = (db.notifications || []).find(n => n.id === notificationId);
    if (notif) {
      notif.is_read = true;
    }
    return { success: true, notification: notif };
  });
};

export const apiMarkAllNotificationsAsRead = async (userId) => {
  return apiCall('/api/notifications/read-all', `read-all-${userId}`, async (db) => {
    for (const notif of (db.notifications || [])) {
      if (notif.recipientId === userId) {
        notif.is_read = true;
      }
    }
    return { success: true };
  });
};
