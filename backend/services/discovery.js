const { getDb } = require('../models/database');
const hitachiApi = require('./hitachiApi');
const sessionManager = require('./sessionManager');

/**
 * 3DC Pair Auto-Discovery Service
 *
 * Discovers storage systems from Ops Center, then finds all Universal Replicator
 * (UR) pairs and groups them by consistency group ID. Filters out inactive mirror
 * units (journalStatus == "SMPL") since those are not part of an active 3DC setup.
 */

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
 * Discovers all storage systems registered in Ops Center.
 * This is the first step in the setup flow -- the user sees a list of
 * discovered storages and provides credentials for each.
 *
 * @returns {Promise<Array<Object>>} Array of storage system objects
 */
async function discoverStorages() {
  const apiConfig = getApiConfig();
  if (!apiConfig) {
    throw new Error('API configuration not found. Please configure the Ops Center connection first.');
  }

  const result = await hitachiApi.listStorages(
    apiConfig.host,
    apiConfig.port,
    apiConfig.useSsl,
    apiConfig.acceptSelfSigned
  );

  // The API returns { data: [...] } with storage objects
  const storages = result.data || result || [];

  if (!Array.isArray(storages)) {
    console.warn('[discovery] Unexpected storages response format:', typeof storages);
    return [];
  }

  console.log(`[discovery] Discovered ${storages.length} storage system(s).`);

  return storages.map((storage) => ({
    storageDeviceId: storage.storageDeviceId,
    model: storage.model || 'Unknown',
    serialNumber: storage.serialNumber || storage.ctl1SerialNumber || 'Unknown',
    svpIp: storage.svpIp || null,
    dkcType: storage.dkcType || null,
  }));
}

/**
 * Discovers all Universal Replicator (UR) pairs for a storage system.
 * Uses the direct pair query endpoint (no copy group context needed).
 * Paginates through all pairs using headLdevId.
 *
 * @param {string} storageDeviceId - Storage device ID to query
 * @returns {Promise<Array<Object>>} Array of UR pair objects
 */
async function discoverPairs(storageDeviceId) {
  const apiConfig = getApiConfig();
  if (!apiConfig) {
    throw new Error('API configuration not found.');
  }

  const session = await sessionManager.getSession(storageDeviceId);
  const allPairs = [];
  let headLdevId = 0;
  const BATCH_SIZE = 500;
  let hasMore = true;

  while (hasMore) {
    const result = await hitachiApi.getRemoteCopyPairs(
      apiConfig.host,
      apiConfig.port,
      apiConfig.useSsl,
      storageDeviceId,
      session.token,
      headLdevId,
      BATCH_SIZE,
      apiConfig.acceptSelfSigned
    );

    const pairs = result.data || result || [];
    if (!Array.isArray(pairs) || pairs.length === 0) {
      hasMore = false;
      break;
    }

    // Filter for Universal Replicator pairs only
    const urPairs = pairs.filter((pair) => pair.replicationType === 'UR');
    allPairs.push(...urPairs);

    // Pagination: if we got a full batch, request the next page
    if (pairs.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      const lastPair = pairs[pairs.length - 1];
      headLdevId = (lastPair.pvolLdevId || 0) + 1;
    }
  }

  console.log(
    `[discovery] Found ${allPairs.length} UR pair(s) on storage ${storageDeviceId}.`
  );

  return allPairs;
}

/**
 * Discovers all UR pairs using the remote mirror copy groups endpoint.
 * This requires both local and remote sessions and returns richer data
 * including copy group names and full pair details.
 *
 * @param {string} localStorageId - Local storage device ID
 * @param {string} remoteStorageId - Remote storage device ID
 * @returns {Promise<Array<Object>>} Array of copy group objects with pairs
 */
async function discoverCopyGroups(localStorageId, remoteStorageId) {
  const apiConfig = getApiConfig();
  if (!apiConfig) {
    throw new Error('API configuration not found.');
  }

  const remoteSessions = await sessionManager.getRemoteSession(localStorageId, remoteStorageId);

  const result = await hitachiApi.getRemoteCopyGroups(
    apiConfig.host,
    apiConfig.port,
    apiConfig.useSsl,
    localStorageId,
    remoteStorageId,
    remoteSessions.localToken,
    remoteSessions.remoteToken,
    apiConfig.acceptSelfSigned
  );

  const copyGroups = result.data || result || [];

  if (!Array.isArray(copyGroups)) {
    console.warn('[discovery] Unexpected copy groups response format.');
    return [];
  }

  // Filter copy groups to only include UR pairs
  const urCopyGroups = copyGroups
    .map((group) => ({
      ...group,
      copyPairs: (group.copyPairs || []).filter((pair) => pair.replicationType === 'UR'),
    }))
    .filter((group) => group.copyPairs.length > 0);

  console.log(
    `[discovery] Found ${urCopyGroups.length} copy group(s) with UR pairs ` +
    `between ${localStorageId} and ${remoteStorageId}.`
  );

  return urCopyGroups;
}

/**
 * Discovers consistency groups by grouping UR pairs by consistencyGroupId.
 * Also queries journal information to enrich the data with journal status
 * and filters out inactive mirror units (SMPL status).
 *
 * @param {string} storageDeviceId
 * @returns {Promise<Array<Object>>} Array of consistency group objects
 */
async function discoverConsistencyGroups(storageDeviceId) {
  const apiConfig = getApiConfig();
  if (!apiConfig) {
    throw new Error('API configuration not found.');
  }

  // Get all UR pairs
  const pairs = await discoverPairs(storageDeviceId);

  // Get journal information to match journals with consistency groups
  const session = await sessionManager.getSession(storageDeviceId);
  let journals = [];

  try {
    const journalResult = await hitachiApi.getJournals(
      apiConfig.host,
      apiConfig.port,
      apiConfig.useSsl,
      storageDeviceId,
      session.token,
      'basic',
      apiConfig.acceptSelfSigned
    );

    const journalList = journalResult.data || journalResult || [];
    if (Array.isArray(journalList)) {
      // Filter out inactive mirror units (SMPL = not configured/in use)
      journals = journalList.filter((j) => j.journalStatus !== 'SMPL');
    }
  } catch (err) {
    console.warn(
      `[discovery] Failed to query journals for ${storageDeviceId}: ${err.message}`
    );
  }

  // Build journal lookup by consistencyGroupId
  const journalsByCg = new Map();
  for (const journal of journals) {
    const cgId = journal.consistencyGroupId;
    if (cgId === undefined || cgId === null) continue;

    if (!journalsByCg.has(cgId)) {
      journalsByCg.set(cgId, []);
    }
    journalsByCg.get(cgId).push({
      journalId: journal.journalId,
      muNumber: journal.muNumber,
      journalStatus: journal.journalStatus,
      usageRate: journal.usageRate,
      qCount: journal.qCount,
      qMarker: journal.qMarker,
      byteFormatCapacity: journal.byteFormatCapacity,
      numOfActivePaths: journal.numOfActivePaths,
    });
  }

  // Group pairs by consistencyGroupId
  const pairsByCg = new Map();
  for (const pair of pairs) {
    const cgId = pair.consistencyGroupId;
    if (cgId === undefined || cgId === null) continue;

    if (!pairsByCg.has(cgId)) {
      pairsByCg.set(cgId, []);
    }
    pairsByCg.get(cgId).push({
      pvolLdevId: pair.pvolLdevId,
      svolLdevId: pair.svolLdevId,
      pvolJournalId: pair.pvolJournalId,
      svolJournalId: pair.svolJournalId,
      pvolStatus: pair.pvolStatus,
      svolStatus: pair.svolStatus,
      fenceLevel: pair.fenceLevel,
      copyProgressRate: pair.copyProgressRate,
      copyGroupName: pair.copyGroupName,
    });
  }

  // Merge all discovered consistency group IDs from both pairs and journals
  const allCgIds = new Set([...pairsByCg.keys(), ...journalsByCg.keys()]);

  const consistencyGroups = [];
  for (const cgId of allCgIds) {
    const cgPairs = pairsByCg.get(cgId) || [];
    const cgJournals = journalsByCg.get(cgId) || [];

    // Determine overall status from journal statuses
    let overallStatus = 'normal';
    const errorStatuses = ['PJNF', 'SJNF', 'PJSF', 'SJSF', 'PJSE', 'SJSE', 'PJES', 'SJES'];
    const warningStatuses = ['PJSN', 'SJSN', 'PJNS', 'SJNS'];

    for (const journal of cgJournals) {
      if (errorStatuses.includes(journal.journalStatus)) {
        overallStatus = 'critical';
        break;
      }
      if (warningStatuses.includes(journal.journalStatus)) {
        overallStatus = 'warning';
      }
    }

    // Check pair statuses for errors
    for (const pair of cgPairs) {
      const pairErrorStatuses = ['PSUE', 'SSUE'];
      const pairWarnStatuses = ['PSUS', 'SSUS', 'SSWS'];

      if (pairErrorStatuses.includes(pair.pvolStatus) || pairErrorStatuses.includes(pair.svolStatus)) {
        overallStatus = 'critical';
        break;
      }
      if (pairWarnStatuses.includes(pair.pvolStatus) || pairWarnStatuses.includes(pair.svolStatus)) {
        if (overallStatus !== 'critical') {
          overallStatus = 'warning';
        }
      }
    }

    // Collect unique remote storage device IDs from pairs
    // (These come from the pair data if available; the exact remote storage ID
    //  is known from the copy group query context rather than the direct pair query.)
    const remoteStorageIds = new Set();
    for (const pair of cgPairs) {
      if (pair.remoteStorageDeviceId) {
        remoteStorageIds.add(pair.remoteStorageDeviceId);
      }
    }

    consistencyGroups.push({
      consistencyGroupId: cgId,
      overallStatus,
      volumeCount: cgPairs.length,
      journalCount: cgJournals.length,
      volumes: cgPairs,
      journals: cgJournals,
      remoteStorageIds: Array.from(remoteStorageIds),
    });
  }

  // Sort by consistency group ID
  consistencyGroups.sort((a, b) => a.consistencyGroupId - b.consistencyGroupId);

  console.log(
    `[discovery] Discovered ${consistencyGroups.length} consistency group(s) ` +
    `on storage ${storageDeviceId}.`
  );

  return consistencyGroups;
}

/**
 * Saves discovered consistency groups to the database for monitoring.
 *
 * @param {string} sourceStorageId - Source (primary) storage device ID
 * @param {string} targetStorageId - Target (DR) storage device ID
 * @param {Array<Object>} groups - Consistency groups from discoverConsistencyGroups
 */
function saveConsistencyGroups(sourceStorageId, targetStorageId, groups) {
  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO consistency_groups (cg_id, name, source_storage_id, target_storage_id, is_monitored)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(cg_id, source_storage_id, target_storage_id) DO UPDATE SET
      name = excluded.name,
      is_monitored = 1
  `);

  // We need a unique constraint for the upsert. Since the table may not have
  // a composite unique constraint, use a transaction with manual check.
  const insertOrUpdate = db.transaction((groups) => {
    for (const group of groups) {
      const existing = db.prepare(
        `SELECT id FROM consistency_groups
         WHERE cg_id = ? AND source_storage_id = ? AND target_storage_id = ?`
      ).get(group.consistencyGroupId, sourceStorageId, targetStorageId);

      if (existing) {
        db.prepare(
          `UPDATE consistency_groups SET is_monitored = 1
           WHERE id = ?`
        ).run(existing.id);
      } else {
        db.prepare(
          `INSERT INTO consistency_groups (cg_id, name, source_storage_id, target_storage_id, is_monitored)
           VALUES (?, ?, ?, ?, 1)`
        ).run(
          group.consistencyGroupId,
          `CG-${group.consistencyGroupId}`,
          sourceStorageId,
          targetStorageId
        );
      }
    }
  });

  insertOrUpdate(groups);

  console.log(
    `[discovery] Saved ${groups.length} consistency group(s) for ` +
    `${sourceStorageId} -> ${targetStorageId}.`
  );
}

/**
 * Runs full discovery: lists storages, finds all UR pairs and consistency groups
 * for each authenticated storage. Returns a complete overview of the 3DC environment.
 *
 * @returns {Promise<Object>} Complete discovery results
 */
async function runFullDiscovery() {
  console.log('[discovery] Starting full 3DC environment discovery...');

  const storages = await discoverStorages();

  // Get list of authenticated storages from the database
  const db = getDb();
  const authenticatedStorages = db.prepare(
    'SELECT storage_device_id FROM storage_credentials WHERE is_authenticated = 1'
  ).all().map((row) => row.storage_device_id);

  const results = {
    storages,
    authenticatedCount: authenticatedStorages.length,
    consistencyGroups: {},
    errors: [],
  };

  // Discover consistency groups for each authenticated storage
  for (const storageId of authenticatedStorages) {
    try {
      const groups = await discoverConsistencyGroups(storageId);
      results.consistencyGroups[storageId] = groups;
    } catch (err) {
      console.error(
        `[discovery] Failed to discover CGs for storage ${storageId}: ${err.message}`
      );
      results.errors.push({
        storageDeviceId: storageId,
        error: err.message,
      });
    }
  }

  const totalCgs = Object.values(results.consistencyGroups)
    .reduce((sum, groups) => sum + groups.length, 0);

  console.log(
    `[discovery] Full discovery complete: ${storages.length} storage(s), ` +
    `${authenticatedStorages.length} authenticated, ${totalCgs} consistency group(s) found.`
  );

  return results;
}

module.exports = {
  discoverStorages,
  discoverPairs,
  discoverCopyGroups,
  discoverConsistencyGroups,
  saveConsistencyGroups,
  runFullDiscovery,
};
