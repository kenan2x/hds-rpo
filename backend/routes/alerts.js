const express = require('express');
const { getDb } = require('../models/database');
const { authenticateToken } = require('./auth');

const router = express.Router();

// All alert routes require authentication
router.use(authenticateToken);

// ---------------------------------------------------------------------------
// Default threshold values
// ---------------------------------------------------------------------------
const DEFAULT_THRESHOLDS = {
  usage_rate_warning: 5,
  usage_rate_critical: 20,
  rpo_seconds_warning: 3600,    // 1 hour
  rpo_seconds_critical: 7200,   // 2 hours
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/alerts
 * List alerts with optional filters.
 * Query params:
 *   - severity: filter by severity level (info, warning, critical)
 *   - acknowledged: filter by acknowledgement status (true/false)
 *   - cg_id: filter by consistency group ID
 *   - limit: max number of results (default: 100)
 *   - offset: pagination offset (default: 0)
 */
router.get('/', (req, res) => {
  try {
    const {
      severity,
      acknowledged,
      cg_id,
      limit = '100',
      offset = '0',
    } = req.query;

    let query = 'SELECT * FROM alerts WHERE 1=1';
    const params = [];

    if (severity) {
      query += ' AND severity = ?';
      params.push(severity);
    }

    if (acknowledged !== undefined) {
      query += ' AND is_acknowledged = ?';
      params.push(acknowledged === 'true' ? 1 : 0);
    }

    if (cg_id) {
      query += ' AND cg_id = ?';
      params.push(parseInt(cg_id, 10));
    }

    query += ' ORDER BY created_at DESC';

    // Apply pagination
    const limitNum = Math.min(parseInt(limit, 10) || 100, 1000);
    const offsetNum = parseInt(offset, 10) || 0;
    query += ' LIMIT ? OFFSET ?';
    params.push(limitNum, offsetNum);

    const db = getDb();
    const alerts = db.prepare(query).all(...params);

    // Get total count for pagination (same filters, no limit/offset)
    let countQuery = 'SELECT COUNT(*) as total FROM alerts WHERE 1=1';
    const countParams = [];

    if (severity) {
      countQuery += ' AND severity = ?';
      countParams.push(severity);
    }
    if (acknowledged !== undefined) {
      countQuery += ' AND is_acknowledged = ?';
      countParams.push(acknowledged === 'true' ? 1 : 0);
    }
    if (cg_id) {
      countQuery += ' AND cg_id = ?';
      countParams.push(parseInt(cg_id, 10));
    }

    const total = db.prepare(countQuery).get(...countParams);

    res.json({
      alerts,
      pagination: {
        total: total.total,
        limit: limitNum,
        offset: offsetNum,
      },
    });
  } catch (err) {
    console.error('[alerts] List alerts error:', err.message);
    res.status(500).json({ error: 'Uyarılar listelenirken bir hata oluştu.' });
  }
});

/**
 * POST /api/alerts/:alertId/acknowledge
 * Acknowledge a specific alert.
 */
router.post('/:alertId/acknowledge', (req, res) => {
  try {
    const { alertId } = req.params;
    const db = getDb();

    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(parseInt(alertId, 10));

    if (!alert) {
      return res.status(404).json({ error: 'Uyarı bulunamadı.' });
    }

    if (alert.is_acknowledged) {
      return res.json({ message: 'Uyarı zaten onaylanmış.', alert_id: parseInt(alertId, 10) });
    }

    db.prepare(
      'UPDATE alerts SET is_acknowledged = 1 WHERE id = ?'
    ).run(parseInt(alertId, 10));

    res.json({
      message: 'Uyarı onaylandı.',
      alert_id: parseInt(alertId, 10),
    });
  } catch (err) {
    console.error('[alerts] Acknowledge error:', err.message);
    res.status(500).json({ error: 'Uyarı onaylanırken bir hata oluştu.' });
  }
});

/**
 * GET /api/alerts/thresholds
 * Get current threshold settings for alert generation.
 * Returns thresholds for usageRate and rpoSeconds (warning + critical levels).
 */
router.get('/thresholds', (_req, res) => {
  try {
    const db = getDb();

    // Fetch threshold-related settings
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE key LIKE 'rpo_threshold_%'"
    ).all();

    const settingsMap = {};
    for (const row of rows) {
      settingsMap[row.key] = row.value;
    }

    const thresholds = {
      usage_rate_warning: parseFloat(settingsMap.rpo_threshold_warning_percent) || DEFAULT_THRESHOLDS.usage_rate_warning,
      usage_rate_critical: parseFloat(settingsMap.rpo_threshold_critical_percent) || DEFAULT_THRESHOLDS.usage_rate_critical,
      rpo_seconds_warning: parseFloat(settingsMap.rpo_threshold_warning_seconds) || DEFAULT_THRESHOLDS.rpo_seconds_warning,
      rpo_seconds_critical: parseFloat(settingsMap.rpo_threshold_critical_seconds) || DEFAULT_THRESHOLDS.rpo_seconds_critical,
    };

    res.json({ thresholds });
  } catch (err) {
    console.error('[alerts] Get thresholds error:', err.message);
    res.status(500).json({ error: 'Eşik değerleri alınırken bir hata oluştu.' });
  }
});

/**
 * POST /api/alerts/thresholds
 * Update threshold settings for alert generation.
 * Body (all optional):
 *   - usage_rate_warning: number (default: 5)
 *   - usage_rate_critical: number (default: 20)
 *   - rpo_seconds_warning: number (default: 3600)
 *   - rpo_seconds_critical: number (default: 7200)
 */
router.post('/thresholds', (req, res) => {
  try {
    const {
      usage_rate_warning,
      usage_rate_critical,
      rpo_seconds_warning,
      rpo_seconds_critical,
    } = req.body;

    // Validate that warning thresholds are less than critical thresholds
    if (usage_rate_warning !== undefined && usage_rate_critical !== undefined) {
      if (parseFloat(usage_rate_warning) >= parseFloat(usage_rate_critical)) {
        return res.status(400).json({
          error: 'Kullanım oranı uyarı eşiği, kritik eşiğinden küçük olmalıdır.',
        });
      }
    }

    if (rpo_seconds_warning !== undefined && rpo_seconds_critical !== undefined) {
      if (parseFloat(rpo_seconds_warning) >= parseFloat(rpo_seconds_critical)) {
        return res.status(400).json({
          error: 'RPO süre uyarı eşiği, kritik eşiğinden küçük olmalıdır.',
        });
      }
    }

    const db = getDb();
    const upsert = db.prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );

    const updates = [];
    if (usage_rate_warning !== undefined) {
      updates.push(['rpo_threshold_warning_percent', String(usage_rate_warning)]);
    }
    if (usage_rate_critical !== undefined) {
      updates.push(['rpo_threshold_critical_percent', String(usage_rate_critical)]);
    }
    if (rpo_seconds_warning !== undefined) {
      updates.push(['rpo_threshold_warning_seconds', String(rpo_seconds_warning)]);
    }
    if (rpo_seconds_critical !== undefined) {
      updates.push(['rpo_threshold_critical_seconds', String(rpo_seconds_critical)]);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'En az bir eşik değeri belirtilmelidir.' });
    }

    const upsertMany = db.transaction((entries) => {
      for (const [key, value] of entries) {
        upsert.run(key, value);
      }
    });

    upsertMany(updates);

    // Return the updated thresholds
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE key LIKE 'rpo_threshold_%'"
    ).all();

    const settingsMap = {};
    for (const row of rows) {
      settingsMap[row.key] = row.value;
    }

    const thresholds = {
      usage_rate_warning: parseFloat(settingsMap.rpo_threshold_warning_percent) || DEFAULT_THRESHOLDS.usage_rate_warning,
      usage_rate_critical: parseFloat(settingsMap.rpo_threshold_critical_percent) || DEFAULT_THRESHOLDS.usage_rate_critical,
      rpo_seconds_warning: parseFloat(settingsMap.rpo_threshold_warning_seconds) || DEFAULT_THRESHOLDS.rpo_seconds_warning,
      rpo_seconds_critical: parseFloat(settingsMap.rpo_threshold_critical_seconds) || DEFAULT_THRESHOLDS.rpo_seconds_critical,
    };

    res.json({
      message: 'Eşik değerleri güncellendi.',
      thresholds,
    });
  } catch (err) {
    console.error('[alerts] Update thresholds error:', err.message);
    res.status(500).json({ error: 'Eşik değerleri güncellenirken bir hata oluştu.' });
  }
});

module.exports = router;
