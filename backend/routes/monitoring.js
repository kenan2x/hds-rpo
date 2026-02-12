const express = require('express');
const { getDb } = require('../models/database');
const { authenticateToken } = require('./auth');

const router = express.Router();

// All monitoring routes require authentication
router.use(authenticateToken);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a timeframe string to a SQLite datetime expression.
 * Supported values: 1h, 6h, 24h, 7d
 * Returns a datetime('now', ...) modifier string.
 */
function getTimeframeModifier(timeframe) {
  const mapping = {
    '1h':  '-1 hours',
    '6h':  '-6 hours',
    '24h': '-24 hours',
    '7d':  '-7 days',
  };
  return mapping[timeframe] || mapping['24h'];
}

/**
 * Determine the severity for a given usageRate based on configurable thresholds.
 * Green (normal): < warning, Yellow (warning): warning-critical, Red (critical): >= critical
 */
function getUsageRateSeverity(usageRate, thresholds) {
  const warningThreshold = thresholds.warning || 5;
  const criticalThreshold = thresholds.critical || 20;

  if (usageRate >= criticalThreshold) return 'critical';
  if (usageRate >= warningThreshold) return 'warning';
  return 'normal';
}

/**
 * Get the RPO thresholds from the settings table.
 */
function getRpoThresholds() {
  const db = getDb();
  const settings = {};
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key LIKE 'rpo_threshold_%'"
  ).all();
  for (const row of rows) {
    settings[row.key] = parseFloat(row.value);
  }
  return {
    usageRate: {
      warning: settings.rpo_threshold_warning_percent || 5,
      critical: settings.rpo_threshold_critical_percent || 20,
    },
    rpoSeconds: {
      warning: settings.rpo_threshold_warning_seconds || 3600,
      critical: settings.rpo_threshold_critical_seconds || 7200,
    },
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/monitoring/groups
 * List all monitored consistency groups with latest RPO data.
 * Returns aggregated group-level RPO (worst-case volume in each group).
 */
router.get('/groups', (_req, res) => {
  try {
    const db = getDb();
    const thresholds = getRpoThresholds();

    // Get all consistency groups
    const groups = db.prepare(
      `SELECT cg.id, cg.cg_id, cg.name, cg.source_storage_id, cg.target_storage_id,
              cg.is_monitored, cg.created_at
       FROM consistency_groups cg
       ORDER BY cg.cg_id`
    ).all();

    // Prepared statements for per-group lookups
    const getLatestRpo = db.prepare(
      `SELECT
         cg_id,
         MAX(usage_rate) as usage_rate,
         MAX(q_count) as q_count,
         SUM(pending_data_bytes) as pending_data_bytes,
         MAX(estimated_rpo_seconds) as estimated_rpo_seconds,
         SUM(block_delta_bytes) as block_delta_bytes,
         journal_status,
         pair_status,
         timestamp
       FROM rpo_history
       WHERE cg_id = ?
         AND timestamp = (
           SELECT MAX(timestamp) FROM rpo_history WHERE cg_id = ?
         )
       GROUP BY cg_id`
    );

    const getVolumeCount = db.prepare(
      `SELECT COUNT(DISTINCT journal_id) as volume_count
       FROM rpo_history
       WHERE cg_id = ?
         AND timestamp = (
           SELECT MAX(timestamp) FROM rpo_history WHERE cg_id = ?
         )`
    );

    const result = groups.map((group) => {
      const latestRpo = getLatestRpo.get(group.cg_id, group.cg_id);
      const volumeInfo = getVolumeCount.get(group.cg_id, group.cg_id);

      const usageRate = latestRpo?.usage_rate ?? null;
      const severity = usageRate !== null
        ? getUsageRateSeverity(usageRate, thresholds.usageRate)
        : 'unknown';

      return {
        id: group.id,
        cg_id: group.cg_id,
        name: group.name,
        source_storage_id: group.source_storage_id,
        target_storage_id: group.target_storage_id,
        is_monitored: !!group.is_monitored,
        volume_count: volumeInfo?.volume_count || 0,
        latest_rpo: latestRpo
          ? {
              usage_rate: latestRpo.usage_rate,
              q_count: latestRpo.q_count,
              pending_data_bytes: latestRpo.pending_data_bytes,
              estimated_rpo_seconds: latestRpo.estimated_rpo_seconds,
              block_delta_bytes: latestRpo.block_delta_bytes,
              journal_status: latestRpo.journal_status,
              pair_status: latestRpo.pair_status,
              timestamp: latestRpo.timestamp,
            }
          : null,
        severity,
      };
    });

    res.json({ groups: result });
  } catch (err) {
    console.error('[monitoring] List groups error:', err.message);
    res.status(500).json({ error: 'Tutarlılık grupları listelenirken bir hata oluştu.' });
  }
});

/**
 * GET /api/monitoring/groups/:cgId
 * Get detailed RPO data for a specific consistency group.
 * Includes both journal-based (Method 1) and block-delta (Method 2) data,
 * trend direction, severity, and aggregated worst-case metrics.
 */
router.get('/groups/:cgId', (req, res) => {
  try {
    const cgIdNum = parseInt(req.params.cgId, 10);
    const db = getDb();
    const thresholds = getRpoThresholds();

    // Get group info
    const group = db.prepare(
      'SELECT * FROM consistency_groups WHERE cg_id = ?'
    ).get(cgIdNum);

    if (!group) {
      return res.status(404).json({ error: 'Tutarlılık grubu bulunamadı.' });
    }

    // Get latest RPO data for all volumes in this group
    const latestData = db.prepare(
      `SELECT *
       FROM rpo_history
       WHERE cg_id = ?
         AND timestamp = (
           SELECT MAX(timestamp) FROM rpo_history WHERE cg_id = ?
         )
       ORDER BY journal_id, mu_number`
    ).all(cgIdNum, cgIdNum);

    // Calculate aggregated group-level metrics (worst-case for rates, sum for bytes)
    let aggregated = null;
    if (latestData.length > 0) {
      aggregated = {
        usage_rate: Math.max(...latestData.map(d => d.usage_rate || 0)),
        q_count: Math.max(...latestData.map(d => d.q_count || 0)),
        pending_data_bytes: latestData.reduce((sum, d) => sum + (d.pending_data_bytes || 0), 0),
        estimated_rpo_seconds: Math.max(...latestData.map(d => d.estimated_rpo_seconds || 0)),
        block_delta_bytes: latestData.reduce((sum, d) => sum + (d.block_delta_bytes || 0), 0),
        copy_speed: latestData[0]?.copy_speed || null,
        timestamp: latestData[0]?.timestamp,
      };
    }

    // Get previous data point for trend calculation
    const previousTimestamp = db.prepare(
      `SELECT DISTINCT timestamp FROM rpo_history
       WHERE cg_id = ?
         AND timestamp < (SELECT MAX(timestamp) FROM rpo_history WHERE cg_id = ?)
       ORDER BY timestamp DESC LIMIT 1`
    ).get(cgIdNum, cgIdNum);

    let trend = null;
    if (previousTimestamp && aggregated) {
      const previousData = db.prepare(
        `SELECT MAX(q_count) as q_count, MAX(usage_rate) as usage_rate
         FROM rpo_history
         WHERE cg_id = ? AND timestamp = ?`
      ).get(cgIdNum, previousTimestamp.timestamp);

      if (previousData) {
        const qCountDiff = (aggregated.q_count || 0) - (previousData.q_count || 0);
        if (qCountDiff > 0) trend = 'increasing';
        else if (qCountDiff < 0) trend = 'decreasing';
        else trend = 'stable';
      }
    }

    const severity = aggregated
      ? getUsageRateSeverity(aggregated.usage_rate, thresholds.usageRate)
      : 'unknown';

    // Collect unique journal/pair statuses across all volumes
    const journalStatuses = [...new Set(latestData.map(d => d.journal_status).filter(Boolean))];
    const pairStatuses = [...new Set(latestData.map(d => d.pair_status).filter(Boolean))];

    res.json({
      group: {
        id: group.id,
        cg_id: group.cg_id,
        name: group.name,
        source_storage_id: group.source_storage_id,
        target_storage_id: group.target_storage_id,
        is_monitored: !!group.is_monitored,
      },
      aggregated,
      trend,
      severity,
      journal_statuses: journalStatuses,
      pair_statuses: pairStatuses,
      volume_count: latestData.length,
    });
  } catch (err) {
    console.error('[monitoring] Get group detail error:', err.message);
    res.status(500).json({ error: 'Grup detayları alınırken bir hata oluştu.' });
  }
});

/**
 * GET /api/monitoring/groups/:cgId/history
 * Get historical RPO data for a specific consistency group.
 * Query params:
 *   - timeframe: 1h, 6h, 24h, 7d (default: 24h)
 *
 * Returns data formatted for chart consumption:
 * Array of { timestamp, usageRate, qCount, pendingDataBytes,
 *            estimatedRpoSeconds, blockDeltaBytes }
 */
router.get('/groups/:cgId/history', (req, res) => {
  try {
    const cgIdNum = parseInt(req.params.cgId, 10);
    const { timeframe = '24h' } = req.query;
    const db = getDb();

    // Validate the consistency group exists
    const group = db.prepare(
      'SELECT cg_id FROM consistency_groups WHERE cg_id = ?'
    ).get(cgIdNum);

    if (!group) {
      return res.status(404).json({ error: 'Tutarlılık grubu bulunamadı.' });
    }

    const modifier = getTimeframeModifier(timeframe);
    if (!modifier) {
      return res.status(400).json({
        error: 'Geçersiz zaman dilimi. Geçerli değerler: 1h, 6h, 24h, 7d',
      });
    }

    // Aggregate per-timestamp: worst-case usageRate and qCount, sum of bytes
    const history = db.prepare(`
      SELECT
        timestamp,
        MAX(usage_rate) as usageRate,
        MAX(q_count) as qCount,
        SUM(pending_data_bytes) as pendingDataBytes,
        MAX(estimated_rpo_seconds) as estimatedRpoSeconds,
        SUM(block_delta_bytes) as blockDeltaBytes
      FROM rpo_history
      WHERE cg_id = ?
        AND timestamp >= datetime('now', ?)
      GROUP BY timestamp
      ORDER BY timestamp ASC
    `).all(cgIdNum, modifier);

    res.json({
      cg_id: cgIdNum,
      timeframe,
      data_points: history.length,
      history,
    });
  } catch (err) {
    console.error('[monitoring] Get history error:', err.message);
    res.status(500).json({ error: 'Geçmiş verileri alınırken bir hata oluştu.' });
  }
});

/**
 * GET /api/monitoring/groups/:cgId/volumes
 * Get volume-level RPO details for a specific consistency group.
 * Returns per-volume data from the most recent poll.
 */
router.get('/groups/:cgId/volumes', (req, res) => {
  try {
    const cgIdNum = parseInt(req.params.cgId, 10);
    const db = getDb();

    // Validate the consistency group exists
    const group = db.prepare(
      'SELECT cg_id FROM consistency_groups WHERE cg_id = ?'
    ).get(cgIdNum);

    if (!group) {
      return res.status(404).json({ error: 'Tutarlılık grubu bulunamadı.' });
    }

    // Get the latest data for each volume (journal_id + mu_number) in this group
    const volumes = db.prepare(`
      SELECT
        journal_id,
        mu_number,
        usage_rate,
        q_count,
        q_marker,
        pending_data_bytes,
        estimated_rpo_seconds,
        block_delta_bytes,
        copy_speed,
        journal_status,
        pair_status,
        timestamp
      FROM rpo_history
      WHERE cg_id = ?
        AND timestamp = (
          SELECT MAX(timestamp) FROM rpo_history WHERE cg_id = ?
        )
      ORDER BY journal_id, mu_number
    `).all(cgIdNum, cgIdNum);

    res.json({
      cg_id: cgIdNum,
      volume_count: volumes.length,
      timestamp: volumes.length > 0 ? volumes[0].timestamp : null,
      volumes,
    });
  } catch (err) {
    console.error('[monitoring] Get volumes error:', err.message);
    res.status(500).json({ error: 'Volume detayları alınırken bir hata oluştu.' });
  }
});

/**
 * POST /api/monitoring/poll
 * Trigger an immediate poll cycle.
 * Delegates to the poller service to execute a full data collection cycle.
 */
router.post('/poll', async (_req, res) => {
  try {
    // Attempt to load the poller service. It may not be initialized yet.
    let poller;
    try {
      poller = require('../services/poller');
    } catch (loadErr) {
      return res.status(503).json({
        error: 'Yoklama servisi henüz başlatılmamış.',
        details: loadErr.message,
      });
    }

    if (typeof poller.pollNow !== 'function') {
      return res.status(503).json({
        error: 'Yoklama servisi hazır değil.',
      });
    }

    // Run the poll cycle asynchronously
    const result = await poller.pollNow();

    res.json({
      message: 'Yoklama döngüsü tamamlandı.',
      ...result,
    });
  } catch (err) {
    console.error('[monitoring] Manual poll error:', err.message);
    res.status(500).json({ error: 'Yoklama sırasında bir hata oluştu.', details: err.message });
  }
});

/**
 * GET /api/monitoring/status
 * Get overall monitoring status: last poll time, next poll, errors.
 */
router.get('/status', (_req, res) => {
  try {
    const db = getDb();

    // Most recent data point timestamp (last poll time)
    const lastPoll = db.prepare(
      'SELECT MAX(timestamp) as last_poll FROM rpo_history'
    ).get();

    // Polling interval setting
    const pollIntervalSetting = db.prepare(
      "SELECT value FROM settings WHERE key = 'polling_interval_seconds'"
    ).get();
    const pollingIntervalSeconds = parseInt(pollIntervalSetting?.value || '300', 10);

    // Calculate next expected poll time
    let nextPoll = null;
    if (lastPoll?.last_poll) {
      const lastPollDate = new Date(lastPoll.last_poll + 'Z');
      nextPoll = new Date(lastPollDate.getTime() + pollingIntervalSeconds * 1000).toISOString();
    }

    // Count monitored and total groups
    const monitoredGroups = db.prepare(
      'SELECT COUNT(*) as count FROM consistency_groups WHERE is_monitored = 1'
    ).get();
    const totalGroups = db.prepare(
      'SELECT COUNT(*) as count FROM consistency_groups'
    ).get();

    // Count authenticated storages
    const authenticatedStorages = db.prepare(
      'SELECT COUNT(*) as count FROM storage_credentials WHERE is_authenticated = 1'
    ).get();

    // Count recent unacknowledged alerts (last 24h)
    const recentAlerts = db.prepare(
      `SELECT COUNT(*) as count FROM alerts
       WHERE is_acknowledged = 0
         AND created_at >= datetime('now', '-24 hours')`
    ).get();

    // Count total data points in the last 24h
    const recentDataPoints = db.prepare(
      `SELECT COUNT(*) as count FROM rpo_history
       WHERE timestamp >= datetime('now', '-24 hours')`
    ).get();

    // Check poller status (gracefully handle missing service)
    let pollerRunning = false;
    try {
      const poller = require('../services/poller');
      pollerRunning = typeof poller.getStatus === 'function' ? poller.getStatus().isRunning : false;
    } catch (_e) {
      // Poller service not available yet
    }

    res.json({
      last_poll: lastPoll?.last_poll || null,
      next_poll: nextPoll,
      polling_interval_seconds: pollingIntervalSeconds,
      poller_running: pollerRunning,
      monitored_groups: monitoredGroups?.count || 0,
      total_groups: totalGroups?.count || 0,
      authenticated_storages: authenticatedStorages?.count || 0,
      unacknowledged_alerts: recentAlerts?.count || 0,
      data_points_24h: recentDataPoints?.count || 0,
    });
  } catch (err) {
    console.error('[monitoring] Get status error:', err.message);
    res.status(500).json({ error: 'İzleme durumu alınırken bir hata oluştu.' });
  }
});

/**
 * PATCH /api/monitoring/groups/:cgId
 * Update group settings (enable/disable monitoring, rename).
 * Body: { is_monitored?: boolean, name?: string }
 */
router.patch('/groups/:cgId', (req, res) => {
  try {
    const cgIdNum = parseInt(req.params.cgId, 10);
    const { is_monitored, name } = req.body;
    const db = getDb();

    const group = db.prepare(
      'SELECT * FROM consistency_groups WHERE cg_id = ?'
    ).get(cgIdNum);

    if (!group) {
      return res.status(404).json({ error: 'Tutarlılık grubu bulunamadı.' });
    }

    // Build dynamic update
    const updates = [];
    const params = [];

    if (is_monitored !== undefined) {
      updates.push('is_monitored = ?');
      params.push(is_monitored ? 1 : 0);
    }

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi.' });
    }

    params.push(cgIdNum);

    db.prepare(
      `UPDATE consistency_groups SET ${updates.join(', ')} WHERE cg_id = ?`
    ).run(...params);

    // Return the updated group
    const updatedGroup = db.prepare(
      'SELECT * FROM consistency_groups WHERE cg_id = ?'
    ).get(cgIdNum);

    res.json({
      message: 'Grup ayarları güncellendi.',
      group: {
        id: updatedGroup.id,
        cg_id: updatedGroup.cg_id,
        name: updatedGroup.name,
        source_storage_id: updatedGroup.source_storage_id,
        target_storage_id: updatedGroup.target_storage_id,
        is_monitored: !!updatedGroup.is_monitored,
      },
    });
  } catch (err) {
    console.error('[monitoring] Update group error:', err.message);
    res.status(500).json({ error: 'Grup ayarları güncellenirken bir hata oluştu.' });
  }
});

module.exports = router;
