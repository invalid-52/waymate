// Seed Service for Waymate — Idempotent creation and synchronization of 9 demo users
// Used for local demo mode when no remote API URL is configured.
// Preserves real non-demo users if already registered (Section 52).

import {
  INITIAL_USERS,
  INITIAL_VEHICLES,
  INITIAL_RIDES,
  INITIAL_BOOKINGS,
  INITIAL_RIDE_REQUESTS,
  INITIAL_REVIEWS,
  INITIAL_LENDING,
  INITIAL_WALLETS,
  INITIAL_WALLET,
  INITIAL_NOTIFICATIONS,
  INITIAL_EVENTS,
  BASE_PLATFORM_STATS
} from '../types/data.js';
import { getStorage, setStorage } from './storage.js';

const STORAGE_KEY = 'waymate_db_v1';
const DEMO_USER_IDS = new Set(INITIAL_USERS.map(u => u.id));
const DEMO_WAYMATE_IDS = new Set(INITIAL_USERS.map(u => u.generatedUserId));

/**
 * Calculates dynamic trust tier and rating for a user based on real records
 */
export const calculateTrustLevel = (user, reviews = [], completedRidesCount = 0) => {
  if (user.trustLevel && user.trustLevel !== 'New Member') {
    return {
      trustLevel: user.trustLevel,
      rating: user.rating || 0,
      ratingDisplay: user.reviewsCount > 0 ? Number(user.rating).toFixed(1) : 'No reviews yet',
      reviewsCount: user.reviewsCount || 0,
      isNew: (user.reviewsCount || 0) === 0
    };
  }

  const userReviews = reviews.filter(r => r.targetUserId === user.id);
  const count = Math.max(userReviews.length, user.reviewsCount || 0);

  if (count === 0) {
    return {
      trustLevel: 'New Member',
      rating: 0,
      ratingDisplay: 'No reviews yet',
      reviewsCount: 0,
      isNew: true
    };
  }

  const avg = user.rating || 4.8;
  const completed = completedRidesCount || user.ridesCompleted || 0;

  let tier = 'Developing Trust';
  if (completed >= 40 && avg >= 4.8) {
    tier = 'Highly Trusted';
  } else if (count >= 5 && avg >= 4.6) {
    tier = 'Trusted Member';
  } else if (count >= 1) {
    tier = 'Developing Trust';
  }

  return {
    trustLevel: tier,
    rating: avg,
    ratingDisplay: avg.toFixed(1),
    reviewsCount: count,
    isNew: false
  };
};

/**
 * Seed or refresh demo data idempotently
 * Preserves newly created non-demo accounts if they exist.
 */
export const seedDemoData = async ({ force = false } = {}) => {
  console.log('Waymate: Initializing connected demo dataset (9 users)...');

  let existingNonDemoUsers = [];
  let existingNonDemoVehicles = [];
  let existingNonDemoBookings = [];
  let existingNonDemoWallets = {};
  let existingNonDemoNotifications = [];

  if (!force) {
    try {
      const raw = getStorage(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.users)) {
          existingNonDemoUsers = parsed.users.filter(
            u => !DEMO_USER_IDS.has(u.id) && !DEMO_WAYMATE_IDS.has(u.generatedUserId)
          );
        }
        if (Array.isArray(parsed.vehicles)) {
          const nonDemoUserIds = new Set(existingNonDemoUsers.map(u => u.id));
          existingNonDemoVehicles = parsed.vehicles.filter(v => nonDemoUserIds.has(v.ownerId));
        }
        if (Array.isArray(parsed.bookings)) {
          const nonDemoUserIds = new Set(existingNonDemoUsers.map(u => u.id));
          existingNonDemoBookings = parsed.bookings.filter(b => nonDemoUserIds.has(b.userId));
        }
        if (Array.isArray(parsed.notifications)) {
          const demoNotifIds = new Set(INITIAL_NOTIFICATIONS.map(n => n.id));
          existingNonDemoNotifications = parsed.notifications.filter(n => !demoNotifIds.has(n.id));
        }
        if (parsed.wallets) {
          for (const u of existingNonDemoUsers) {
            if (parsed.wallets[u.id]) {
              existingNonDemoWallets[u.id] = parsed.wallets[u.id];
            }
          }
        }
      }
    } catch (e) {
      console.warn('Waymate: Could not read existing non-demo records', e);
    }
  }

  const seededUsers = INITIAL_USERS.map(u => {
    const trust = calculateTrustLevel(u, INITIAL_REVIEWS);
    return {
      ...u,
      rating: trust.rating,
      reviewsCount: trust.reviewsCount,
      trustLevel: trust.trustLevel,
      avatar: u.avatar
    };
  });

  const allUsers = [...seededUsers, ...existingNonDemoUsers];
  const allVehicles = [...INITIAL_VEHICLES, ...existingNonDemoVehicles];
  const allBookings = [...INITIAL_BOOKINGS, ...existingNonDemoBookings];
  const allWallets = { ...INITIAL_WALLETS, ...existingNonDemoWallets };
  const allNotifications = [...INITIAL_NOTIFICATIONS, ...existingNonDemoNotifications];

  // Construct initial database state
  const initialDb = {
    user: seededUsers[0], // Arjun Mehta as active user by default
    users: allUsers,
    vehicles: allVehicles,
    rides: INITIAL_RIDES,
    bookings: allBookings,
    rideRequests: INITIAL_RIDE_REQUESTS,
    reviews: INITIAL_REVIEWS,
    lending: INITIAL_LENDING,
    notifications: allNotifications,
    wallets: allWallets,
    wallet: allWallets['user-demo-01'] || INITIAL_WALLET,
    events: INITIAL_EVENTS,
    platformStats: {
      ...BASE_PLATFORM_STATS,
      members: allUsers.length
    },
    seededAt: Date.now()
  };

  // Remote persistence is handled by the configured Waymate API; this helper seeds local demo mode only.

  // Save to persistent storage
  try {
    setStorage(STORAGE_KEY, JSON.stringify(initialDb));
    console.log(`Waymate: Demo dataset successfully seeded (${allUsers.length} total users).`);
  } catch (err) {
    console.error('Waymate: Failed to persist seeded database to cookies', err);
  }

  return initialDb;
};

export const seedWaymateDemoData = seedDemoData;
