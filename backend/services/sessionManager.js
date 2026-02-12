const hitachiApi = require('./hitachiApi');
const { getDb } = require('../models/database');
const { decrypt } = require('../utils/encryption');

/**
 * Session Manager for Hitachi Ops Center REST API
 *
 * Maintains a pool of active sessions per storage device. Each storage system
 * supports a maximum of 64 concurrent sessions. Sessions have a configurable
 * alive time (default 300 seconds) and are renewed automatically before timeout.
 *
 * Sessions are stored in memory only -- they are not persisted. On application
 * restart all sessions must be recreated.
 */

const MAX_SESSIONS_PER_STORAGE = 64;
const DEFAULT_ALIVE_TIME = 300; // seconds
const RENEWAL_MARGIN_SECONDS = 60; // Renew session 60 seconds before timeout

/**
 * In-memory session store.
 * Key: storageDeviceId
 * Value: {
 *   token: string,
 *   sessionId: number,
 *   createdAt: number (timestamp ms),
 *   aliveTime: number (seconds),
 *   renewalTimer: NodeJS.Timeout | null
 * }
 */
const sessions = new Map();

/**
 * Retrieves the Ops Center API configuration from the database.
 *
 * @returns {{ host: string, port: number, useSsl: boolean, acceptSelfSigned: boolean } | null}
 */
function getApiConfig() {
  const db = getDb();
  const config = db.prepare(
    'SELECT host, port, use_ssl, accept_self_signed FROM api_config ORDER BY id DESC LIMIT 1'
  ).get();

  if (!config) {
    return null;
  }

  return {
    host: config.host,
    port: config.port,
    useSsl: !!config.use_ssl,
    acceptSelfSigned: !!config.accept_self_signed,
  };
}

/**
 * Retrieves stored (encrypted) credentials for a storage device from the database,
 * decrypts the password, and returns them.
 *
 * @param {string} storageDeviceId
 * @returns {{ username: string, password: string } | null}
 */
function getStorageCredentials(storageDeviceId) {
  const db = getDb();
  const cred = db.prepare(
    `SELECT username, encrypted_password, iv, auth_tag
     FROM storage_credentials
     WHERE storage_device_id = ? AND is_authenticated = 1`
  ).get(storageDeviceId);

  if (!cred || !cred.encrypted_password) {
    return null;
  }

  try {
    const password = decrypt(cred.encrypted_password, cred.iv, cred.auth_tag);
    return {
      username: cred.username,
      password,
    };
  } catch (err) {
    console.error(
      `[sessionManager] Failed to decrypt credentials for storage ${storageDeviceId}:`,
      err.message
    );
    return null;
  }
}

/**
 * Schedules automatic session renewal. The session is renewed by creating
 * a new session before the current one expires. The old session is then deleted.
 *
 * @param {string} storageDeviceId
 */
function scheduleRenewal(storageDeviceId) {
  const session = sessions.get(storageDeviceId);
  if (!session) return;

  // Clear any existing renewal timer
  if (session.renewalTimer) {
    clearTimeout(session.renewalTimer);
    session.renewalTimer = null;
  }

  const renewInMs = Math.max(
    (session.aliveTime - RENEWAL_MARGIN_SECONDS) * 1000,
    30000 // minimum 30 seconds
  );

  session.renewalTimer = setTimeout(async () => {
    try {
      console.log(`[sessionManager] Renewing session for storage ${storageDeviceId}`);
      await renewSession(storageDeviceId);
    } catch (err) {
      console.error(
        `[sessionManager] Failed to renew session for storage ${storageDeviceId}:`,
        err.message
      );
      // Remove the stale session so the next getSession call creates a fresh one
      sessions.delete(storageDeviceId);
    }
  }, renewInMs);

  // Prevent the timer from keeping Node.js alive during shutdown
  if (session.renewalTimer.unref) {
    session.renewalTimer.unref();
  }
}

/**
 * Renews a session by creating a new one and deleting the old one.
 *
 * @param {string} storageDeviceId
 */
async function renewSession(storageDeviceId) {
  const apiConfig = getApiConfig();
  if (!apiConfig) {
    throw new Error('API configuration not found');
  }

  const credentials = getStorageCredentials(storageDeviceId);
  if (!credentials) {
    throw new Error(`No valid credentials for storage ${storageDeviceId}`);
  }

  const oldSession = sessions.get(storageDeviceId);

  // Create a new session
  const result = await hitachiApi.createSession(
    apiConfig.host,
    apiConfig.port,
    apiConfig.useSsl,
    storageDeviceId,
    credentials.username,
    credentials.password,
    apiConfig.acceptSelfSigned,
    DEFAULT_ALIVE_TIME
  );

  // Store the new session
  sessions.set(storageDeviceId, {
    token: result.token,
    sessionId: result.sessionId,
    createdAt: Date.now(),
    aliveTime: DEFAULT_ALIVE_TIME,
    renewalTimer: null,
  });

  // Schedule renewal for the new session
  scheduleRenewal(storageDeviceId);

  // Delete the old session (best effort)
  if (oldSession) {
    try {
      await hitachiApi.deleteSession(
        apiConfig.host,
        apiConfig.port,
        apiConfig.useSsl,
        storageDeviceId,
        oldSession.sessionId,
        oldSession.token,
        apiConfig.acceptSelfSigned
      );
    } catch (err) {
      // Old session may already have expired; this is not critical
      console.warn(
        `[sessionManager] Could not delete old session ${oldSession.sessionId} ` +
        `for storage ${storageDeviceId}: ${err.message}`
      );
    }
  }

  console.log(
    `[sessionManager] Session renewed for storage ${storageDeviceId} ` +
    `(sessionId: ${result.sessionId})`
  );
}

/**
 * Returns an existing valid session for a storage device, or creates a new one.
 *
 * @param {string} storageDeviceId
 * @returns {Promise<{ token: string, sessionId: number }>}
 */
async function getSession(storageDeviceId) {
  // Check for existing session
  const existing = sessions.get(storageDeviceId);
  if (existing) {
    const elapsed = (Date.now() - existing.createdAt) / 1000;
    // If the session is still within its alive window (with margin), return it
    if (elapsed < existing.aliveTime - RENEWAL_MARGIN_SECONDS) {
      return {
        token: existing.token,
        sessionId: existing.sessionId,
      };
    }
    // Session is about to expire or has expired, create a new one below
  }

  const apiConfig = getApiConfig();
  if (!apiConfig) {
    throw new Error('API configuration not found. Please configure the Ops Center connection first.');
  }

  const credentials = getStorageCredentials(storageDeviceId);
  if (!credentials) {
    throw new Error(
      `No authenticated credentials found for storage ${storageDeviceId}. ` +
      'Please authenticate the storage system first.'
    );
  }

  // Check session count limit
  const currentCount = sessions.size;
  if (currentCount >= MAX_SESSIONS_PER_STORAGE && !sessions.has(storageDeviceId)) {
    console.warn(
      `[sessionManager] Session pool is large (${currentCount} active). ` +
      `Max per storage is ${MAX_SESSIONS_PER_STORAGE}.`
    );
  }

  // Create new session
  const result = await hitachiApi.createSession(
    apiConfig.host,
    apiConfig.port,
    apiConfig.useSsl,
    storageDeviceId,
    credentials.username,
    credentials.password,
    apiConfig.acceptSelfSigned,
    DEFAULT_ALIVE_TIME
  );

  sessions.set(storageDeviceId, {
    token: result.token,
    sessionId: result.sessionId,
    createdAt: Date.now(),
    aliveTime: DEFAULT_ALIVE_TIME,
    renewalTimer: null,
  });

  // Schedule automatic renewal
  scheduleRenewal(storageDeviceId);

  console.log(
    `[sessionManager] New session created for storage ${storageDeviceId} ` +
    `(sessionId: ${result.sessionId})`
  );

  return {
    token: result.token,
    sessionId: result.sessionId,
  };
}

/**
 * Returns both a local and remote session, required for remote copy operations.
 * The Hitachi API requires Authorization (local) and Remote-Authorization (remote)
 * headers for endpoints that access remote storage data.
 *
 * @param {string} localStorageId - Local storage device ID
 * @param {string} remoteStorageId - Remote storage device ID
 * @returns {Promise<{ localToken: string, remoteToken: string, localSessionId: number, remoteSessionId: number }>}
 */
async function getRemoteSession(localStorageId, remoteStorageId) {
  const [localSession, remoteSession] = await Promise.all([
    getSession(localStorageId),
    getSession(remoteStorageId),
  ]);

  return {
    localToken: localSession.token,
    remoteToken: remoteSession.token,
    localSessionId: localSession.sessionId,
    remoteSessionId: remoteSession.sessionId,
  };
}

/**
 * Deletes a single session and removes it from the pool.
 *
 * @param {string} storageDeviceId
 */
async function destroySession(storageDeviceId) {
  const session = sessions.get(storageDeviceId);
  if (!session) return;

  // Clear renewal timer
  if (session.renewalTimer) {
    clearTimeout(session.renewalTimer);
  }

  const apiConfig = getApiConfig();
  if (apiConfig) {
    try {
      await hitachiApi.deleteSession(
        apiConfig.host,
        apiConfig.port,
        apiConfig.useSsl,
        storageDeviceId,
        session.sessionId,
        session.token,
        apiConfig.acceptSelfSigned
      );
      console.log(
        `[sessionManager] Session ${session.sessionId} deleted for storage ${storageDeviceId}`
      );
    } catch (err) {
      console.warn(
        `[sessionManager] Error deleting session ${session.sessionId} ` +
        `for storage ${storageDeviceId}: ${err.message}`
      );
    }
  }

  sessions.delete(storageDeviceId);
}

/**
 * Cleans up all active sessions. Should be called during application shutdown
 * to release session resources on the storage systems.
 */
async function cleanupAllSessions() {
  console.log(`[sessionManager] Cleaning up ${sessions.size} active sessions...`);

  const apiConfig = getApiConfig();
  if (!apiConfig) {
    // No API config means we can't call the API to delete sessions;
    // just clear local state
    for (const [, session] of sessions) {
      if (session.renewalTimer) {
        clearTimeout(session.renewalTimer);
      }
    }
    sessions.clear();
    console.log('[sessionManager] All sessions cleared (no API config, local cleanup only).');
    return;
  }

  const deletionPromises = [];

  for (const [storageDeviceId, session] of sessions) {
    // Clear renewal timers
    if (session.renewalTimer) {
      clearTimeout(session.renewalTimer);
    }

    // Attempt to delete session on the storage
    deletionPromises.push(
      hitachiApi.deleteSession(
        apiConfig.host,
        apiConfig.port,
        apiConfig.useSsl,
        storageDeviceId,
        session.sessionId,
        session.token,
        apiConfig.acceptSelfSigned
      ).then(() => {
        console.log(
          `[sessionManager] Session ${session.sessionId} deleted for storage ${storageDeviceId}`
        );
      }).catch((err) => {
        console.warn(
          `[sessionManager] Failed to delete session ${session.sessionId} ` +
          `for storage ${storageDeviceId}: ${err.message}`
        );
      })
    );
  }

  await Promise.allSettled(deletionPromises);
  sessions.clear();
  console.log('[sessionManager] All sessions cleaned up.');
}

/**
 * Returns the count of active sessions across all storages.
 *
 * @returns {number}
 */
function getActiveSessionCount() {
  return sessions.size;
}

/**
 * Returns a summary of all active sessions (for diagnostics).
 *
 * @returns {Array<{ storageDeviceId: string, sessionId: number, createdAt: number, aliveTime: number }>}
 */
function getSessionSummary() {
  const summary = [];
  for (const [storageDeviceId, session] of sessions) {
    summary.push({
      storageDeviceId,
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      aliveTime: session.aliveTime,
      ageSeconds: Math.round((Date.now() - session.createdAt) / 1000),
    });
  }
  return summary;
}

module.exports = {
  getSession,
  getRemoteSession,
  destroySession,
  cleanupAllSessions,
  getActiveSessionCount,
  getSessionSummary,
};
