const express = require('express');
const axios = require('axios');
const https = require('https');
const { getDb } = require('../models/database');
const { authenticateToken } = require('./auth');
const { encrypt } = require('../utils/encryption');

const router = express.Router();

// All storage routes require authentication
router.use(authenticateToken);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the current Ops Center API configuration from the database.
 * Returns null if not configured.
 */
function getApiConfig() {
  const db = getDb();
  return db.prepare('SELECT * FROM api_config ORDER BY id DESC LIMIT 1').get() || null;
}

/**
 * Build the Ops Center base URL from the stored config.
 */
function buildBaseUrl(config) {
  const protocol = config.use_ssl ? 'https' : 'http';
  return `${protocol}://${config.host}:${config.port}`;
}

/**
 * Create an axios instance configured for the Ops Center API.
 */
function createAxiosInstance(config) {
  const httpsAgent = config.accept_self_signed
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

  return axios.create({
    baseURL: buildBaseUrl(config),
    timeout: 30000,
    httpsAgent,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/storages
 * List all known storages (from discovery or stored).
 * Passwords are never returned.
 */
router.get('/', (_req, res) => {
  try {
    const db = getDb();
    const storages = db.prepare(
      `SELECT id, storage_device_id, model, serial_number, username,
              is_authenticated, created_at, updated_at
       FROM storage_credentials
       ORDER BY storage_device_id`
    ).all();

    res.json({ storages });
  } catch (err) {
    console.error('[storages] List error:', err.message);
    res.status(500).json({ error: 'Depolama sistemleri listelenirken bir hata oluştu.' });
  }
});

/**
 * POST /api/storages/discover
 * Trigger storage discovery from the Ops Center API.
 * Calls GET /ConfigurationManager/v1/objects/storages and stores/updates
 * discovered storages in the database.
 */
router.post('/discover', async (_req, res) => {
  try {
    const apiConfig = getApiConfig();
    if (!apiConfig) {
      return res.status(400).json({ error: 'Önce Ops Center API yapılandırmasını kaydedin.' });
    }

    const client = createAxiosInstance(apiConfig);
    const response = await client.get('/ConfigurationManager/v1/objects/storages');

    const discoveredStorages = response.data?.data || [];

    if (discoveredStorages.length === 0) {
      return res.json({
        message: 'Ops Center üzerinde kayıtlı depolama sistemi bulunamadı.',
        storages: [],
        discovered_count: 0,
      });
    }

    const db = getDb();
    const upsertStmt = db.prepare(
      `INSERT INTO storage_credentials (storage_device_id, model, serial_number)
       VALUES (?, ?, ?)
       ON CONFLICT(storage_device_id)
       DO UPDATE SET model = excluded.model, serial_number = excluded.serial_number,
                     updated_at = datetime('now')`
    );

    const upsertMany = db.transaction((storages) => {
      for (const storage of storages) {
        upsertStmt.run(
          String(storage.storageDeviceId),
          storage.model || null,
          storage.serialNumber || null
        );
      }
    });

    upsertMany(discoveredStorages);

    // Return the updated list
    const storages = db.prepare(
      `SELECT id, storage_device_id, model, serial_number, username,
              is_authenticated, created_at, updated_at
       FROM storage_credentials
       ORDER BY storage_device_id`
    ).all();

    res.json({
      message: `${discoveredStorages.length} depolama sistemi keşfedildi.`,
      storages,
      discovered_count: discoveredStorages.length,
    });
  } catch (err) {
    console.error('[storages] Discovery error:', err.message);

    let errorMessage = 'Depolama keşfi sırasında bir hata oluştu.';
    if (err.code === 'ECONNREFUSED') {
      errorMessage = 'Ops Center API bağlantısı reddedildi.';
    } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      errorMessage = 'Ops Center API bağlantısı zaman aşımına uğradı.';
    } else if (err.response) {
      errorMessage = `Ops Center API hatası: ${err.response.status} ${err.response.statusText}`;
    }

    res.status(502).json({ error: errorMessage, details: err.message });
  }
});

/**
 * POST /api/storages/:storageDeviceId/authenticate
 * Validate and store credentials for a specific storage.
 * Creates a test session on the storage; if successful, stores the
 * encrypted credentials and then deletes the test session.
 */
router.post('/:storageDeviceId/authenticate', async (req, res) => {
  const { storageDeviceId } = req.params;
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gereklidir.' });
  }

  try {
    const apiConfig = getApiConfig();
    if (!apiConfig) {
      return res.status(400).json({ error: 'Önce Ops Center API yapılandırmasını kaydedin.' });
    }

    const client = createAxiosInstance(apiConfig);
    const storageBasePath = `/ConfigurationManager/v1/objects/storages/${storageDeviceId}`;

    // Step 1: Create a test session with the provided credentials
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
    let sessionResponse;
    try {
      sessionResponse = await client.post(
        `${storageBasePath}/sessions`,
        { aliveTime: 60 },
        {
          headers: {
            'Authorization': `Basic ${basicAuth}`,
          },
        }
      );
    } catch (sessionErr) {
      if (sessionErr.response && sessionErr.response.status === 401) {
        return res.status(401).json({
          error: 'Kimlik doğrulama başarısız. Kullanıcı adı ve şifreyi kontrol edin.',
        });
      }
      throw sessionErr;
    }

    const sessionToken = sessionResponse.data?.token;
    const sessionId = sessionResponse.data?.sessionId;

    // Step 2: Delete the test session immediately
    if (sessionToken && sessionId !== undefined) {
      try {
        await client.delete(
          `${storageBasePath}/sessions/${sessionId}`,
          {
            headers: {
              'Authorization': `Session ${sessionToken}`,
            },
          }
        );
      } catch (deleteErr) {
        // Non-critical: log but don't fail the operation
        console.warn(
          `[storages] Failed to delete test session ${sessionId} for ${storageDeviceId}:`,
          deleteErr.message
        );
      }
    }

    // Step 3: Encrypt and store the credentials
    const { encrypted, iv, authTag } = encrypt(password);
    const db = getDb();

    const existing = db.prepare(
      'SELECT id FROM storage_credentials WHERE storage_device_id = ?'
    ).get(storageDeviceId);

    if (existing) {
      db.prepare(
        `UPDATE storage_credentials
         SET username = ?, encrypted_password = ?, iv = ?, auth_tag = ?,
             is_authenticated = 1, updated_at = datetime('now')
         WHERE id = ?`
      ).run(username, encrypted, iv, authTag, existing.id);
    } else {
      db.prepare(
        `INSERT INTO storage_credentials
           (storage_device_id, username, encrypted_password, iv, auth_tag, is_authenticated)
         VALUES (?, ?, ?, ?, ?, 1)`
      ).run(storageDeviceId, username, encrypted, iv, authTag);
    }

    res.json({
      message: 'Kimlik doğrulama başarılı. Bilgiler kaydedildi.',
      storage_device_id: storageDeviceId,
      is_authenticated: true,
    });
  } catch (err) {
    console.error(`[storages] Authentication error for ${storageDeviceId}:`, err.message);

    let errorMessage = 'Kimlik doğrulama sırasında bir hata oluştu.';
    if (err.code === 'ECONNREFUSED') {
      errorMessage = 'Ops Center API bağlantısı reddedildi.';
    } else if (err.response) {
      errorMessage = `API hatası: ${err.response.status} ${err.response.statusText}`;
    }

    res.status(502).json({ error: errorMessage, details: err.message });
  }
});

/**
 * GET /api/storages/:storageDeviceId/status
 * Get session/connection status for a specific storage.
 * Returns authentication state and last known connectivity info.
 */
router.get('/:storageDeviceId/status', (req, res) => {
  try {
    const { storageDeviceId } = req.params;
    const db = getDb();

    const storage = db.prepare(
      `SELECT id, storage_device_id, model, serial_number, username,
              is_authenticated, created_at, updated_at
       FROM storage_credentials
       WHERE storage_device_id = ?`
    ).get(storageDeviceId);

    if (!storage) {
      return res.status(404).json({ error: 'Depolama sistemi bulunamadı.' });
    }

    // Check if there are any recent RPO data points (indicates active monitoring)
    const lastDataPoint = db.prepare(
      `SELECT timestamp FROM rpo_history
       WHERE cg_id IN (
         SELECT cg_id FROM consistency_groups WHERE source_storage_id = ? OR target_storage_id = ?
       )
       ORDER BY timestamp DESC LIMIT 1`
    ).get(storageDeviceId, storageDeviceId);

    // Check for recent alerts related to this storage
    const recentAlerts = db.prepare(
      `SELECT COUNT(*) as count FROM alerts
       WHERE cg_id IN (
         SELECT cg_id FROM consistency_groups WHERE source_storage_id = ? OR target_storage_id = ?
       )
       AND is_acknowledged = 0`
    ).get(storageDeviceId, storageDeviceId);

    res.json({
      storage_device_id: storage.storage_device_id,
      model: storage.model,
      serial_number: storage.serial_number,
      is_authenticated: !!storage.is_authenticated,
      has_credentials: !!storage.username,
      last_data_timestamp: lastDataPoint?.timestamp || null,
      unacknowledged_alerts: recentAlerts?.count || 0,
      updated_at: storage.updated_at,
    });
  } catch (err) {
    console.error('[storages] Status error:', err.message);
    res.status(500).json({ error: 'Durum bilgisi alınırken bir hata oluştu.' });
  }
});

module.exports = router;
