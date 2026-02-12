const cron = require('node-cron');
const { getDb } = require('../models/database');
const hitachiApi = require('./hitachiApi');
const sessionManager = require('./sessionManager');
const rpoCalculator = require('./rpoCalculator');
const discovery = require('./discovery');

/**
 * Background Polling Service
 *
 * Periodically polls all monitored storage systems to collect RPO data.
 * Each cycle: refreshes cache, queries journals, queries pairs, queries LDEVs,
 * calculates RPO metrics, stores results in SQLite, and checks alert thresholds.
 *
 * Default interval: 5 minutes (configurable).
 * If one storage fails, the others continue to be polled.
 */

let cronJob = null;
let isPolling = false;
let lastPollTime = null;
let lastPollError = null;

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

  if (!config) return null;

  return {
    host: config.host,
    port: config.port,
    useSsl: !!config.use_ssl,
    acceptSelfSigned: !!config.accept_self_signed,
  };
}

/**
 * Retrieves a specific setting value from the settings table.
 *
 * @param {string} key
 * @returns {string|null}
 */
function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

/**
 * Returns the configured RPO alert thresholds.
 *
 * @returns {{ warningPercent: number, criticalPercent: number }}
 */
function getThresholds() {
  const warning = parseInt(getSetting('rpo_threshold_warning_percent') || '5', 10);
  const critical = parseInt(getSetting('rpo_threshold_critical_percent') || '20', 10);
  return { warningPercent: warning, criticalPercent: critical };
}

/**
 * Returns all authenticated storage device IDs from the database.
 *
 * @returns {Array<{ storage_device_id: string }>}
 */
function getAuthenticatedStorages() {
  const db = getDb();
  return db.prepare(
    'SELECT storage_device_id FROM storage_credentials WHERE is_authenticated = 1'
  ).all();
}

/**
 * Returns all monitored consistency groups from the database.
 *
 * @returns {Array<Object>}
 */
function getMonitoredGroups() {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM consistency_groups WHERE is_monitored = 1'
  ).all();
}

/**
 * Stores a single RPO data point in the rpo_history table.
 *
 * @param {Object} data
 */
function storeRpoDataPoint(data) {
  const db = getDb();
  db.prepare(`
    INSERT INTO rpo_history
      (cg_id, journal_id, mu_number, usage_rate, q_count, q_marker,
       pending_data_bytes, estimated_rpo_seconds, block_delta_bytes,
       copy_speed, journal_status, pair_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.cgId,
    data.journalId || null,
    data.muNumber || null,
    data.usageRate || null,
    data.qCount || null,
    data.qMarker || null,
    data.pendingDataBytes || null,
    data.estimatedRpoSeconds || null,
    data.blockDeltaBytes || null,
    data.copySpeed || null,
    data.journalStatus || null,
    data.pairStatus || null
  );
}

/**
 * Creates an alert record when a threshold is breached.
 *
 * @param {number} cgId - Consistency group ID
 * @param {string} alertType - Type of alert (e.g., 'usage_rate_warning', 'journal_error')
 * @param {string} severity - 'warning' | 'critical' | 'info'
 * @param {string} message - Human-readable alert message
 */
function createAlert(cgId, alertType, severity, message) {
  const db = getDb();

  // Check if an identical unacknowledged alert already exists to avoid duplicates
  const existing = db.prepare(`
    SELECT id FROM alerts
    WHERE cg_id = ? AND alert_type = ? AND severity = ? AND is_acknowledged = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(cgId, alertType, severity);

  if (!existing) {
    db.prepare(`
      INSERT INTO alerts (cg_id, alert_type, severity, message)
      VALUES (?, ?, ?, ?)
    `).run(cgId, alertType, severity, message);

    console.log(`[poller] Alert created: [${severity}] CG-${cgId}: ${message}`);
  }
}

/**
 * Checks RPO thresholds and creates alerts when breached.
 *
 * @param {Object} rpoData - Calculated RPO metrics from rpoCalculator
 */
function checkThresholds(rpoData) {
  const thresholds = getThresholds();
  const cgId = rpoData.consistencyGroupId;

  // Check usageRate thresholds
  if (rpoData.usageRate >= thresholds.criticalPercent) {
    createAlert(
      cgId,
      'usage_rate_critical',
      'critical',
      `Journal kullanim orani kritik seviyede: %${rpoData.usageRate} ` +
      `(Esik: %${thresholds.criticalPercent}). ` +
      `Journal ID: ${rpoData.journalId}, Bekleyen veri: ${rpoCalculator.formatBytes(rpoData.pendingDataBytes)}`
    );
  } else if (rpoData.usageRate >= thresholds.warningPercent) {
    createAlert(
      cgId,
      'usage_rate_warning',
      'warning',
      `Journal kullanim orani uyari seviyesinde: %${rpoData.usageRate} ` +
      `(Esik: %${thresholds.warningPercent}). ` +
      `Journal ID: ${rpoData.journalId}`
    );
  }

  // Check journal status for error conditions
  const errorStatuses = ['PJNF', 'SJNF', 'PJSF', 'SJSF', 'PJSE', 'SJSE', 'PJES', 'SJES'];
  if (rpoData.journalStatus && errorStatuses.includes(rpoData.journalStatus)) {
    createAlert(
      cgId,
      'journal_status_error',
      'critical',
      `Journal durumu hata: ${rpoData.journalStatus}. ` +
      `Journal ID: ${rpoData.journalId}, MU: ${rpoData.muNumber}`
    );
  }
}

/**
 * Polls a single storage system: refreshes cache, queries journals and pairs,
 * calculates RPO metrics, and stores results.
 *
 * @param {string} storageDeviceId
 * @param {Object} apiConfig
 */
async function pollStorage(storageDeviceId, apiConfig) {
  console.log(`[poller] Polling storage ${storageDeviceId}...`);

  try {
    // Get session for this storage
    const session = await sessionManager.getSession(storageDeviceId);

    // Step 1: Refresh cache
    try {
      await hitachiApi.refreshCache(
        apiConfig.host, apiConfig.port, apiConfig.useSsl,
        storageDeviceId, session.token, apiConfig.acceptSelfSigned
      );
    } catch (err) {
      console.warn(`[poller] Cache refresh failed for ${storageDeviceId}: ${err.message}`);
      // Continue anyway -- stale data is better than no data
    }

    // Step 2: Query journal info (basic and detail)
    let journalsBasic = { data: [] };
    let journalsDetail = { data: [] };

    try {
      const [basicResult, detailResult] = await Promise.all([
        hitachiApi.getJournals(
          apiConfig.host, apiConfig.port, apiConfig.useSsl,
          storageDeviceId, session.token, 'basic', apiConfig.acceptSelfSigned
        ),
        hitachiApi.getJournals(
          apiConfig.host, apiConfig.port, apiConfig.useSsl,
          storageDeviceId, session.token, 'detail', apiConfig.acceptSelfSigned
        ),
      ]);
      journalsBasic = basicResult;
      journalsDetail = detailResult;
    } catch (err) {
      console.error(`[poller] Failed to query journals for ${storageDeviceId}: ${err.message}`);
      return; // Cannot calculate RPO without journal data
    }

    // Build a map of journal detail by journalId for quick lookup
    const detailMap = new Map();
    const journalDetailList = journalsDetail.data || journalsDetail || [];
    if (Array.isArray(journalDetailList)) {
      for (const detail of journalDetailList) {
        detailMap.set(detail.journalId, detail);
      }
    }

    // Step 3: Process each journal entry (basic)
    const journalList = journalsBasic.data || journalsBasic || [];
    if (!Array.isArray(journalList)) {
      console.warn(`[poller] Unexpected journal data format for ${storageDeviceId}`);
      return;
    }

    for (const journal of journalList) {
      // Skip journals that are not in use (SMPL = mirror not configured)
      if (journal.journalStatus === 'SMPL') {
        continue;
      }

      // Get copy speed from detail info
      const detail = detailMap.get(journal.journalId);
      const copySpeed = detail ? detail.copySpeed || 0 : 0;

      // Calculate journal-based RPO (Method 1)
      const rpoData = rpoCalculator.calculateJournalRpo(journal, copySpeed);

      // Store data point
      storeRpoDataPoint({
        cgId: journal.consistencyGroupId,
        journalId: journal.journalId,
        muNumber: journal.muNumber,
        usageRate: rpoData.usageRate,
        qCount: rpoData.qCount,
        qMarker: rpoData.qMarker,
        pendingDataBytes: rpoData.pendingDataBytes,
        estimatedRpoSeconds: rpoData.estimatedRpoSeconds,
        copySpeed: rpoData.copySpeed,
        journalStatus: rpoData.journalStatus,
        pairStatus: null, // Filled from pair query below
      });

      // Check thresholds and generate alerts
      checkThresholds(rpoData);
    }

    // Step 4: Query remote copy pairs for pair status and block delta (Method 2)
    try {
      let headLdevId = 0;
      let hasMore = true;
      const BATCH_SIZE = 500;

      while (hasMore) {
        const pairsResult = await hitachiApi.getRemoteCopyPairs(
          apiConfig.host, apiConfig.port, apiConfig.useSsl,
          storageDeviceId, session.token, headLdevId, BATCH_SIZE, apiConfig.acceptSelfSigned
        );

        const pairs = pairsResult.data || pairsResult || [];
        if (!Array.isArray(pairs) || pairs.length === 0) {
          hasMore = false;
          break;
        }

        for (const pair of pairs) {
          if (pair.replicationType !== 'UR') continue;

          // Try to get LDEV info for block delta calculation (Method 2)
          try {
            const [pvolInfo, svolInfo] = await Promise.all([
              hitachiApi.getLdevInfo(
                apiConfig.host, apiConfig.port, apiConfig.useSsl,
                storageDeviceId, session.token, pair.pvolLdevId, apiConfig.acceptSelfSigned
              ),
              // Note: svolLdevId may be on a different storage; if so we would need
              // a remote session. For now, try the local storage.
              hitachiApi.getLdevInfo(
                apiConfig.host, apiConfig.port, apiConfig.useSsl,
                storageDeviceId, session.token, pair.svolLdevId, apiConfig.acceptSelfSigned
              ).catch(() => null), // S-VOL may not be on this storage
            ]);

            if (pvolInfo && svolInfo) {
              const blockDelta = rpoCalculator.calculateBlockDelta(
                pvolInfo.numOfUsedBlock,
                svolInfo.numOfUsedBlock
              );

              // Update the most recent rpo_history entry for this CG with block delta
              const db = getDb();
              db.prepare(`
                UPDATE rpo_history
                SET block_delta_bytes = ?, pair_status = ?
                WHERE cg_id = ? AND journal_id IS NOT NULL
                ORDER BY id DESC LIMIT 1
              `).run(
                blockDelta.blockDeltaBytes,
                pair.pvolStatus || pair.svolStatus || null,
                pair.consistencyGroupId
              );
            }
          } catch (err) {
            // Block delta is supplementary; log but do not fail
            console.warn(
              `[poller] Block delta calculation failed for LDEV ${pair.pvolLdevId}: ${err.message}`
            );
          }
        }

        // Pagination: if we got a full batch, there may be more
        if (pairs.length < BATCH_SIZE) {
          hasMore = false;
        } else {
          // Next page starts after the last LDEV ID in this batch
          const lastPair = pairs[pairs.length - 1];
          headLdevId = (lastPair.pvolLdevId || 0) + 1;
        }
      }
    } catch (err) {
      console.warn(`[poller] Pair query failed for ${storageDeviceId}: ${err.message}`);
      // Non-fatal: we already have journal-based RPO data
    }

    console.log(`[poller] Polling complete for storage ${storageDeviceId}`);
  } catch (err) {
    console.error(`[poller] Error polling storage ${storageDeviceId}: ${err.message}`);
    throw err;
  }
}

/**
 * Runs a single poll cycle across all authenticated storage systems.
 * Errors on individual storages do not stop the cycle from completing.
 */
async function pollCycle() {
  if (isPolling) {
    console.log('[poller] Poll cycle already in progress, skipping.');
    return;
  }

  isPolling = true;
  lastPollError = null;
  const startTime = Date.now();

  console.log('[poller] Starting poll cycle...');

  try {
    const apiConfig = getApiConfig();
    if (!apiConfig) {
      console.warn('[poller] No API configuration found. Skipping poll cycle.');
      return;
    }

    const storages = getAuthenticatedStorages();
    if (storages.length === 0) {
      console.warn('[poller] No authenticated storages found. Skipping poll cycle.');
      return;
    }

    const errors = [];

    // Poll each storage system independently
    for (const storage of storages) {
      try {
        await pollStorage(storage.storage_device_id, apiConfig);
      } catch (err) {
        errors.push({
          storageDeviceId: storage.storage_device_id,
          error: err.message,
        });
      }
    }

    if (errors.length > 0) {
      lastPollError = `${errors.length} storage(s) failed: ${errors.map(e => e.storageDeviceId).join(', ')}`;
      console.warn(`[poller] Poll cycle completed with errors: ${lastPollError}`);
    }

    lastPollTime = new Date().toISOString();
    const duration = Date.now() - startTime;
    console.log(`[poller] Poll cycle finished in ${duration}ms.`);
  } catch (err) {
    lastPollError = err.message;
    console.error(`[poller] Poll cycle failed: ${err.message}`);
  } finally {
    isPolling = false;
  }
}

/**
 * Starts the background polling service with the configured interval.
 * Reads the interval from the settings table (polling_interval_seconds).
 */
function startPolling() {
  if (cronJob) {
    console.log('[poller] Polling is already running.');
    return;
  }

  const intervalSeconds = parseInt(getSetting('polling_interval_seconds') || '300', 10);
  const intervalMinutes = Math.max(1, Math.round(intervalSeconds / 60));

  // Build cron expression: every N minutes
  const cronExpression = `*/${intervalMinutes} * * * *`;

  cronJob = cron.schedule(cronExpression, () => {
    pollCycle().catch((err) => {
      console.error('[poller] Unhandled error in poll cycle:', err.message);
    });
  });

  console.log(
    `[poller] Background polling started with interval: every ${intervalMinutes} minute(s) ` +
    `(cron: ${cronExpression})`
  );

  // Run an initial poll immediately
  pollCycle().catch((err) => {
    console.error('[poller] Error in initial poll cycle:', err.message);
  });
}

/**
 * Stops the background polling service.
 */
function stopPolling() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[poller] Background polling stopped.');
  }
}

/**
 * Triggers an immediate poll cycle (manual refresh).
 *
 * @returns {Promise<void>}
 */
async function pollNow() {
  console.log('[poller] Manual poll triggered.');
  await pollCycle();
}

/**
 * Updates the polling interval. Restarts the cron job if currently running.
 *
 * @param {number} minutes - New interval in minutes (minimum 1)
 */
function setInterval(minutes) {
  const validMinutes = Math.max(1, Math.round(minutes));
  const db = getDb();

  db.prepare('UPDATE settings SET value = ?, updated_at = datetime(\'now\') WHERE key = ?')
    .run(String(validMinutes * 60), 'polling_interval_seconds');

  console.log(`[poller] Polling interval updated to ${validMinutes} minute(s).`);

  // Restart with new interval if currently running
  if (cronJob) {
    stopPolling();
    startPolling();
  }
}

/**
 * Returns the current polling status for diagnostics.
 *
 * @returns {Object}
 */
function getStatus() {
  const intervalSeconds = parseInt(getSetting('polling_interval_seconds') || '300', 10);

  return {
    isRunning: !!cronJob,
    isPolling,
    lastPollTime,
    lastPollError,
    intervalSeconds,
    intervalMinutes: Math.round(intervalSeconds / 60),
  };
}

module.exports = {
  startPolling,
  stopPolling,
  pollNow,
  setInterval,
  getStatus,
};
