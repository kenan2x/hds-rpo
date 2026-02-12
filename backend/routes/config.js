const express = require('express');
const axios = require('axios');
const https = require('https');
const { getDb } = require('../models/database');
const { authenticateToken } = require('./auth');
const { encrypt } = require('../utils/encryption');
const protectorApi = require('../services/protectorApi');

const router = express.Router();

// All config routes require authentication
router.use(authenticateToken);

/**
 * Helper: build the Ops Center base URL from the stored (or provided) config.
 */
function buildBaseUrl(config) {
  const protocol = config.use_ssl ? 'https' : 'http';
  return `${protocol}://${config.host}:${config.port}`;
}

/**
 * GET /api/config
 * Retrieve the current Ops Center API configuration (host, port, SSL settings).
 */
router.get('/', (_req, res) => {
  try {
    const db = getDb();
    const config = db.prepare('SELECT * FROM api_config ORDER BY id DESC LIMIT 1').get();
    res.json({ config: config || null });
  } catch (err) {
    console.error('[config] Get config error:', err.message);
    res.status(500).json({ error: 'Yapılandırma bilgileri alınırken bir hata oluştu.' });
  }
});

/**
 * POST /api/config
 * Save or update the Ops Center API configuration.
 */
router.post('/', (req, res) => {
  try {
    const { host, port = 23451, use_ssl = true, accept_self_signed = false } = req.body;

    if (!host) {
      return res.status(400).json({ error: 'API host adresi gereklidir.' });
    }

    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return res.status(400).json({ error: 'Geçersiz port numarası.' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM api_config ORDER BY id DESC LIMIT 1').get();

    if (existing) {
      db.prepare(
        `UPDATE api_config
         SET host = ?, port = ?, use_ssl = ?, accept_self_signed = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(host, portNum, use_ssl ? 1 : 0, accept_self_signed ? 1 : 0, existing.id);
    } else {
      db.prepare(
        `INSERT INTO api_config (host, port, use_ssl, accept_self_signed)
         VALUES (?, ?, ?, ?)`
      ).run(host, portNum, use_ssl ? 1 : 0, accept_self_signed ? 1 : 0);
    }

    const config = db.prepare('SELECT * FROM api_config ORDER BY id DESC LIMIT 1').get();
    res.json({ config });
  } catch (err) {
    console.error('[config] Save config error:', err.message);
    res.status(500).json({ error: 'Yapılandırma kaydedilirken bir hata oluştu.' });
  }
});

/**
 * POST /api/config/test
 * Test connection to Ops Center by calling GET /ConfigurationManager/v1/objects/storages.
 * Uses the currently saved config (or can accept host/port/ssl in body for pre-save testing).
 */
router.post('/test', async (req, res) => {
  try {
    const db = getDb();

    // Allow testing with provided values (before saving) or fall back to stored config
    let config;
    if (req.body.host) {
      config = {
        host: req.body.host,
        port: req.body.port || 23451,
        use_ssl: req.body.use_ssl !== undefined ? req.body.use_ssl : true,
        accept_self_signed: req.body.accept_self_signed !== undefined ? req.body.accept_self_signed : false,
      };
    } else {
      config = db.prepare('SELECT * FROM api_config ORDER BY id DESC LIMIT 1').get();
      if (!config) {
        return res.status(400).json({ error: 'Henüz API yapılandırması kaydedilmemiş.' });
      }
    }

    const baseUrl = buildBaseUrl(config);
    const url = `${baseUrl}/ConfigurationManager/v1/objects/storages`;

    const httpsAgent = config.accept_self_signed
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;

    const response = await axios.get(url, {
      timeout: 15000,
      httpsAgent,
    });

    const storageCount = response.data?.data?.length || 0;

    res.json({
      success: true,
      message: `Bağlantı başarılı. ${storageCount} depolama sistemi bulundu.`,
      storages_found: storageCount,
    });
  } catch (err) {
    console.error('[config] Connection test error:', err.message);

    let errorMessage = 'Bağlantı testi başarısız.';
    if (err.code === 'ECONNREFUSED') {
      errorMessage = 'Bağlantı reddedildi. Host ve port bilgilerini kontrol edin.';
    } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      errorMessage = 'Bağlantı zaman aşımına uğradı. Ağ bağlantısını kontrol edin.';
    } else if (err.code === 'ENOTFOUND') {
      errorMessage = 'Host adresi çözümlenemedi. Adresi kontrol edin.';
    } else if (err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
      errorMessage = 'SSL sertifikası doğrulanamadı. Öz-imzalı sertifika kabul seçeneğini etkinleştirin.';
    } else if (err.response) {
      errorMessage = `API yanıt hatası: ${err.response.status} ${err.response.statusText}`;
    }

    res.status(502).json({
      success: false,
      error: errorMessage,
      details: err.message,
    });
  }
});

/**
 * GET /api/config/settings
 * Retrieve all application settings.
 */
router.get('/settings', (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json({ settings });
  } catch (err) {
    console.error('[config] Get settings error:', err.message);
    res.status(500).json({ error: 'Ayarlar alınırken bir hata oluştu.' });
  }
});

/**
 * PUT /api/config/settings
 * Update one or more application settings.
 * Body: { "key1": "value1", "key2": "value2" }
 */
router.put('/settings', (req, res) => {
  try {
    const updates = req.body;

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Ayar verileri gereklidir.' });
    }

    const db = getDb();
    const upsert = db.prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );

    const upsertMany = db.transaction((entries) => {
      for (const [key, value] of entries) {
        upsert.run(key, String(value));
      }
    });

    upsertMany(Object.entries(updates));

    // Return all settings after update
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json({ settings });
  } catch (err) {
    console.error('[config] Update settings error:', err.message);
    res.status(500).json({ error: 'Ayarlar güncellenirken bir hata oluştu.' });
  }
});

// ---------------------------------------------------------------------------
// Protector Configuration
// ---------------------------------------------------------------------------

/**
 * GET /api/config/protector
 * Retrieve the Protector configuration (port, username — never the password).
 */
router.get('/protector', (_req, res) => {
  try {
    const db = getDb();
    const config = db.prepare(
      'SELECT protector_host, protector_port, protector_username FROM api_config ORDER BY id DESC LIMIT 1'
    ).get();

    res.json({
      protector: config
        ? {
            host: config.protector_host || null,
            port: config.protector_port || 20964,
            username: config.protector_username || null,
            is_configured: !!(config.protector_host && config.protector_username),
          }
        : null,
    });
  } catch (err) {
    console.error('[config] Get protector config error:', err.message);
    res.status(500).json({ error: 'Protector yapılandırması alınırken bir hata oluştu.' });
  }
});

/**
 * POST /api/config/protector
 * Save or update Protector configuration (port, username, password).
 * The password is encrypted before storage.
 */
router.post('/protector', (req, res) => {
  try {
    const { host, port = 20964, username, password } = req.body;

    if (!host || !username || !password) {
      return res.status(400).json({ error: 'Protector host, kullanıcı adı ve şifresi gereklidir.' });
    }

    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return res.status(400).json({ error: 'Geçersiz port numarası.' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM api_config ORDER BY id DESC LIMIT 1').get();

    if (!existing) {
      return res.status(400).json({
        error: 'Önce Ops Center API yapılandırmasını kaydedin.',
      });
    }

    // Encrypt the password
    const { encrypted, iv, authTag } = encrypt(password);

    db.prepare(
      `UPDATE api_config SET
         protector_host = ?,
         protector_port = ?,
         protector_username = ?,
         protector_encrypted_password = ?,
         protector_iv = ?,
         protector_auth_tag = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(host, portNum, username, encrypted, iv, authTag, existing.id);

    res.json({
      message: 'Protector yapılandırması kaydedildi.',
      protector: {
        host,
        port: portNum,
        username,
        is_configured: true,
      },
    });
  } catch (err) {
    console.error('[config] Save protector config error:', err.message);
    res.status(500).json({ error: 'Protector yapılandırması kaydedilirken bir hata oluştu.' });
  }
});

/**
 * POST /api/config/protector/test
 * Test connection to Ops Center Protector via Common Services authentication.
 */
router.post('/protector/test', async (req, res) => {
  try {
    const db = getDb();
    const apiConfig = db.prepare(
      'SELECT accept_self_signed FROM api_config ORDER BY id DESC LIMIT 1'
    ).get();

    const host = req.body.host;
    const port = parseInt(req.body.port || '20964', 10);
    const username = req.body.username;
    const password = req.body.password;

    if (!host) {
      return res.status(400).json({ error: 'Protector host adresi gereklidir.' });
    }
    if (!username || !password) {
      return res.status(400).json({ error: 'Kullanıcı adı ve şifre gereklidir.' });
    }

    const result = await protectorApi.testConnection(
      host,
      port,
      username,
      password,
      !!(apiConfig?.accept_self_signed)
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Protector bağlantısı başarılı.',
        details: result,
      });
    } else {
      res.status(401).json({
        success: false,
        error: `Protector bağlantısı başarısız: ${result.error}`,
        details: result,
      });
    }
  } catch (err) {
    console.error('[config] Protector test error:', err.message);
    res.status(502).json({
      success: false,
      error: 'Protector bağlantı testi sırasında bir hata oluştu.',
      details: err.message,
    });
  }
});

module.exports = router;
