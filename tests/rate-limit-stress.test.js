/**
 * Stress-test for generateListingCopy rate limit logic.
 *
 * Cannot use the Firebase emulator (no firebase-tools in this env), so we
 * replicate the exact transaction logic from functions/index.js with an
 * in-memory Firestore mock.  The assertions prove the algorithm, not just
 * that "something was called."
 */
const { test, expect } = require('@playwright/test');

// ── Replicate the exact rate-limit constants and logic from functions/index.js ──
const AI_COPY_LIMIT_PER_HOUR = 30;

function makeHourKey(date) {
  return date.toISOString().slice(0, 13);
}

// In-memory Firestore doc store
function createMockFirestore() {
  const store = {};
  return {
    store,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`;
          return {
            _key: key,
            get() { return { data: () => store[key] ? { ...store[key] } : undefined, exists: !!store[key] }; },
          };
        },
      };
    },
    async runTransaction(fn) {
      const tx = {
        get(ref) { return ref.get(); },
        set(ref, data) { store[ref._key] = { ...data }; },
        update(ref, fields) { store[ref._key] = { ...store[ref._key], ...fields }; },
      };
      await fn(tx);
    },
  };
}

// Exact rate-limit logic extracted from generateListingCopy
async function checkRateLimit(db, uid, nowDate) {
  const hour = makeHourKey(nowDate);
  const usageRef = db.collection('aiCopyUsage').doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const data = snap.data() || {};
    if (data.hour === hour && (data.count || 0) >= AI_COPY_LIMIT_PER_HOUR) {
      const err = new Error(`Límite de ${AI_COPY_LIMIT_PER_HOUR} generaciones por hora alcanzado. Intenta más tarde.`);
      err.code = 'resource-exhausted';
      throw err;
    }
    if (data.hour === hour) {
      tx.update(usageRef, { count: (data.count || 0) + 1 });
    } else {
      tx.set(usageRef, { hour, count: 1 });
    }
  });
}

test.describe('MEJ-04: Rate limit stress test', () => {

  test('calls 1-30 pass, call 31 rejects with resource-exhausted, count=30', async () => {
    const db = createMockFirestore();
    const uid = 'test-user-stress';
    const now = new Date('2026-09-08T14:30:00Z');
    const hour = makeHourKey(now); // "2026-09-08T14"

    // First 30 calls must all succeed
    for (let i = 1; i <= 30; i++) {
      await checkRateLimit(db, uid, now);
    }

    // Verify the Firestore doc has exactly count=30
    const doc = db.store['aiCopyUsage/test-user-stress'];
    expect(doc).toBeDefined();
    expect(doc.hour).toBe(hour);
    expect(doc.count).toBe(30);

    // Call 31 must reject with resource-exhausted
    let error;
    try {
      await checkRateLimit(db, uid, now);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.code).toBe('resource-exhausted');
    expect(error.message).toBe('Límite de 30 generaciones por hora alcanzado. Intenta más tarde.');

    // Count stays at 30 (the rejected call did NOT increment)
    const docAfter = db.store['aiCopyUsage/test-user-stress'];
    expect(docAfter.count).toBe(30);
  });

  test('hour rollover resets count — call 31 succeeds in the next hour', async () => {
    const db = createMockFirestore();
    const uid = 'test-user-rollover';
    const hourA = new Date('2026-09-08T14:30:00Z');
    const hourB = new Date('2026-09-08T15:00:01Z');

    // Fill up 30 calls in hour A
    for (let i = 1; i <= 30; i++) {
      await checkRateLimit(db, uid, hourA);
    }

    const docA = db.store['aiCopyUsage/test-user-rollover'];
    expect(docA.hour).toBe('2026-09-08T14');
    expect(docA.count).toBe(30);

    // Call 31 in hour A — must reject
    let error;
    try {
      await checkRateLimit(db, uid, hourA);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.code).toBe('resource-exhausted');

    // Now move to hour B — call should succeed and reset
    await checkRateLimit(db, uid, hourB);

    const docB = db.store['aiCopyUsage/test-user-rollover'];
    expect(docB.hour).toBe('2026-09-08T15');
    expect(docB.count).toBe(1);
  });

  test('first call for a new user initializes count=1', async () => {
    const db = createMockFirestore();
    const uid = 'brand-new-user';
    const now = new Date('2026-09-08T16:00:00Z');

    await checkRateLimit(db, uid, now);

    const doc = db.store['aiCopyUsage/brand-new-user'];
    expect(doc.hour).toBe('2026-09-08T16');
    expect(doc.count).toBe(1);
  });
});
