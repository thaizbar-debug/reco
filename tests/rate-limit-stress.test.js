/**
 * Stress-test for generateListingCopy rate limit — exercises the REAL
 * handler code from functions/index.js by intercepting Firebase module
 * requires and supplying mocks for Firestore, Auth, AppCheck, etc.
 *
 * The rate-limit logic (hour-bucket, count check, transaction) is NOT
 * reimplemented here — it runs verbatim from the source file.
 */
const { test, expect } = require('@playwright/test');
const Module = require('module');
const path = require('path');

// ── In-memory Firestore mock ──
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
            get() {
              return Promise.resolve({
                data: () => store[key] ? { ...store[key] } : undefined,
                exists: !!store[key],
              });
            },
            create(data) { store[key] = { ...data }; return Promise.resolve(); },
          };
        },
        where() { return { where() { return this; }, count() { return { get() { return Promise.resolve({ data: () => ({ count: 0 }) }); } }; } }; },
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

// ── Load the real functions/index.js with mocked Firebase ──
function loadRealHandler() {
  const mockDb = createMockFirestore();
  const handlers = {};
  const originalResolve = Module._resolveFilename;

  const mocks = {
    'firebase-functions/v2/https': {
      onCall(configOrHandler, maybeHandler) {
        const handler = typeof configOrHandler === 'function' ? configOrHandler : maybeHandler;
        const name = `__pending_${Object.keys(handlers).length}`;
        const sentinel = { __handler: handler, __name: name };
        handlers[name] = handler;
        return sentinel;
      },
      HttpsError: class HttpsError extends Error {
        constructor(code, message) {
          super(message);
          this.code = code;
        }
      },
    },
    'firebase-functions/params': {
      defineSecret(name) { return { value: () => 'fake-key-for-test', name }; },
    },
    'firebase-functions/v2/firestore': {
      onDocumentWritten: () => ({}),
      onDocumentCreated: () => ({}),
    },
    'firebase-functions/v2/scheduler': {
      onSchedule: () => ({}),
    },
    'firebase-functions': {
      logger: { info() {}, warn() {}, error() {} },
    },
    'firebase-admin/app': {
      initializeApp() {},
    },
    'firebase-admin/auth': {
      getAuth() {
        return { getUser() { return Promise.resolve({}); }, setCustomUserClaims() { return Promise.resolve(); } };
      },
    },
    'firebase-admin/firestore': {
      getFirestore() { return mockDb; },
      FieldValue: { serverTimestamp() { return new Date(); }, increment(n) { return n; } },
    },
  };

  // Intercept require() for firebase modules
  Module._resolveFilename = function(request, parent, ...rest) {
    if (mocks[request]) return request;
    return originalResolve.call(this, request, parent, ...rest);
  };

  const originalLoad = Module._cache;
  for (const [modName, modExports] of Object.entries(mocks)) {
    const fakeModule = new Module(modName);
    fakeModule.exports = modExports;
    fakeModule.loaded = true;
    require.cache[modName] = fakeModule;
  }

  // Clear any prior cached version of functions/index.js
  const functionsPath = path.resolve(__dirname, '..', 'functions', 'index.js');
  delete require.cache[functionsPath];

  let exports;
  try {
    exports = require(functionsPath);
  } finally {
    Module._resolveFilename = originalResolve;
    // Clean up mocks from cache
    for (const modName of Object.keys(mocks)) {
      delete require.cache[modName];
    }
    delete require.cache[functionsPath];
  }

  // Find the generateListingCopy handler
  const glc = exports.generateListingCopy;
  if (!glc || !glc.__handler) {
    throw new Error('Could not extract generateListingCopy handler from functions/index.js');
  }

  return { handler: glc.__handler, db: mockDb, HttpsError: mocks['firebase-functions/v2/https'].HttpsError };
}

function makeRequest(uid, data, hourOverride) {
  return {
    auth: { uid, token: { email_verified: true } },
    app: { appId: 'test-app' },
    data: data || { district: 'Miraflores', area: 120 },
    rawRequest: { headers: {} },
    _hourOverride: hourOverride,
  };
}

test.describe('MEJ-04: Rate limit stress test (real handler)', () => {

  test('calls 1-30 pass rate limit, call 31 rejects with resource-exhausted, count=30', async () => {
    const { handler, db, HttpsError } = loadRealHandler();
    const uid = 'stress-test-user';

    // Calls 1-30: all should pass the rate-limit check.
    // They will fail at the fetch() to OpenAI — that's expected and fine.
    // We catch those errors and only care about resource-exhausted.
    for (let i = 1; i <= 30; i++) {
      try {
        await handler(makeRequest(uid));
      } catch (e) {
        // "fetch is not defined" or OpenAI errors are expected — rate limit passed
        if (e.code === 'resource-exhausted') {
          throw new Error(`Call ${i} was rejected by rate limit but should have passed`);
        }
      }
    }

    // Verify the Firestore doc has exactly count=30
    const doc = db.store['aiCopyUsage/stress-test-user'];
    expect(doc).toBeDefined();
    expect(doc.count).toBe(30);
    // hour should be a 13-char ISO slice like "2026-09-08T18"
    expect(doc.hour).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);

    // Call 31: must reject with resource-exhausted
    let error;
    try {
      await handler(makeRequest(uid));
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.code).toBe('resource-exhausted');
    expect(error.message).toBe('Límite de 30 generaciones por hora alcanzado. Intenta más tarde.');

    // Count must still be 30 — rejected call did NOT increment
    const docAfter = db.store['aiCopyUsage/stress-test-user'];
    expect(docAfter.count).toBe(30);
  });

  test('hour rollover resets count — call succeeds in new hour', async () => {
    const { handler, db } = loadRealHandler();
    const uid = 'rollover-test-user';

    // Fill up 30 calls in current hour
    for (let i = 1; i <= 30; i++) {
      try {
        await handler(makeRequest(uid));
      } catch (e) {
        if (e.code === 'resource-exhausted') {
          throw new Error(`Call ${i} rejected unexpectedly`);
        }
      }
    }

    expect(db.store['aiCopyUsage/rollover-test-user'].count).toBe(30);
    const originalHour = db.store['aiCopyUsage/rollover-test-user'].hour;

    // Call 31 in same hour — must reject
    let error;
    try {
      await handler(makeRequest(uid));
    } catch (e) {
      error = e;
    }
    expect(error.code).toBe('resource-exhausted');

    // Simulate hour change by directly mutating the stored hour to a past one
    db.store['aiCopyUsage/rollover-test-user'].hour = '2020-01-01T00';

    // Next call should succeed (new hour != stored hour → reset)
    let resetError;
    try {
      await handler(makeRequest(uid));
    } catch (e) {
      if (e.code === 'resource-exhausted') {
        resetError = e;
      }
      // Other errors (fetch/OpenAI) are fine — rate limit passed
    }
    expect(resetError).toBeUndefined();

    // Count should be 1 in the new hour
    const doc = db.store['aiCopyUsage/rollover-test-user'];
    expect(doc.count).toBe(1);
    expect(doc.hour).not.toBe('2020-01-01T00');
  });

  test('first call for a new user initializes count=1', async () => {
    const { handler, db } = loadRealHandler();
    const uid = 'brand-new-user';

    try {
      await handler(makeRequest(uid));
    } catch (e) {
      if (e.code === 'resource-exhausted') {
        throw new Error('First call should not be rate-limited');
      }
    }

    const doc = db.store['aiCopyUsage/brand-new-user'];
    expect(doc).toBeDefined();
    expect(doc.count).toBe(1);
    expect(doc.hour).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
  });
});
