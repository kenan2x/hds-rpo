const { getDb } = require('../models/database');
const hitachiApi = require('./hitachiApi');
const protectorApi = require('./protectorApi');
const sessionManager = require('./sessionManager');
const { decrypt } = require('../utils/encryption');

/**
 * 3DC Pair Auto-Discovery Service
 *
 * Discovers storage systems and replication pairs using two complementary methods:
 * 1. Ops Center Protector / Administrator API — for pair and replication topology discovery
 * 2. Configuration Manager REST API — for journal-level data and direct pair queries
 *
 * Falls back gracefully: if Protector is not configured or returns no data,
 * the service uses Configuration Manager's journal data to discover CGs.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiConfig() {
  const db = getDb();
  const config = db.prepare(
    `SELECT host, port, use_ssl, accept_self_signed,
            protector_host, protector_port, protector_username,
            protector_encrypted_password, protector_iv, protector_auth_tag
     FROM api_config ORDER BY id DESC LIMIT 1`
  ).get();

  if (!config) return null;

  return {
    host: config.host,
    port: config.port,
    useSsl: !!config.use_ssl,
    acceptSelfSigned: !!config.accept_self_signed,
    protectorHost: config.protector_host || null,
    protectorPort: config.protector_port || 20964,
    protectorUsername: config.protector_username || null,
    protectorEncryptedPassword: config.protector_encrypted_password || null,
    protectorIv: config.protector_iv || null,
    protectorAuthTag: config.protector_auth_tag || null,
  };
}

/**
 * Returns decrypted Protector credentials if configured.
 */
function getProtectorCredentials(apiConfig) {
  if (!apiConfig.protectorHost || !apiConfig.protectorUsername || !apiConfig.protectorEncryptedPassword) {
    return null;
  }
  try {
    const password = decrypt(
      apiConfig.protectorEncryptedPassword,
      apiConfig.protectorIv,
      apiConfig.protectorAuthTag
    );
    return { username: apiConfig.protectorUsername, password };
  } catch (err) {
    console.error('[discovery] Failed to decrypt Protector credentials:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Configuration Manager Discovery
// ---------------------------------------------------------------------------

/**
 * Discovers all storage systems registered in Ops Center.
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
 * Discovers all UR pairs for a storage using the direct pair query endpoint.
 */
async function discoverPairs(storageDeviceId) {
  const apiConfig = getApiConfig();
  if (!apiConfig) throw new Error('API configuration not found.');

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

    const urPairs = pairs.filter((pair) => pair.replicationType === 'UR');
    allPairs.push(...urPairs);

    if (pairs.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      const lastPair = pairs[pairs.length - 1];
      headLdevId = (lastPair.pvolLdevId || 0) + 1;
    }
  }

  console.log(`[discovery] Found ${allPairs.length} UR pair(s) on storage ${storageDeviceId}.`);
  return allPairs;
}

/**
 * Discovers UR pairs using remote mirror copy groups (requires dual tokens).
 */
async function discoverCopyGroups(localStorageId, remoteStorageId) {
  const apiConfig = getApiConfig();
  if (!apiConfig) throw new Error('API configuration not found.');

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
 * Also queries journal information for volume counts and status data.
 *
 * KEY FIX: Uses journal `numOfLdevs` field to calculate volume count
 * even when direct pair queries return 0 results.
 */
async function discoverConsistencyGroups(storageDeviceId) {
  const apiConfig = getApiConfig();
  if (!apiConfig) throw new Error('API configuration not found.');

  // Get all UR pairs (may be empty for some configurations)
  let pairs = [];
  try {
    pairs = await discoverPairs(storageDeviceId);
  } catch (err) {
    console.warn(
      `[discovery] Direct pair query failed for ${storageDeviceId}: ${err.message}. ` +
      'Will try alternative methods.'
    );
  }

  // If direct pair query returned 0, try remote-mirror-copygroups with known authenticated storages
  if (pairs.length === 0) {
    const db = getDb();
    const otherStorages = db.prepare(
      `SELECT storage_device_id FROM storage_credentials
       WHERE is_authenticated = 1 AND storage_device_id != ?`
    ).all(storageDeviceId).map((r) => r.storage_device_id);

    for (const remoteId of otherStorages) {
      try {
        const copyGroups = await discoverCopyGroups(storageDeviceId, remoteId);
        for (const cg of copyGroups) {
          for (const pair of cg.copyPairs) {
            pairs.push({
              ...pair,
              copyGroupName: cg.copyGroupName,
              remoteStorageDeviceId: remoteId,
            });
          }
        }
        if (pairs.length > 0) {
          console.log(
            `[discovery] Found ${pairs.length} pair(s) via copy groups ` +
            `between ${storageDeviceId} and ${remoteId}`
          );
        }
      } catch (err) {
        console.warn(
          `[discovery] Copy group query failed for ${storageDeviceId}→${remoteId}: ${err.message}`
        );
      }
    }
  }

  // Get journal information
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
      // Filter out inactive mirror units (SMPL = not configured)
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
      numOfLdevs: journal.numOfLdevs || 0,
      firstLdevId: journal.firstLdevId,
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
      remoteStorageDeviceId: pair.remoteStorageDeviceId,
    });
  }

  // Merge all CG IDs from both pairs and journals
  const allCgIds = new Set([...pairsByCg.keys(), ...journalsByCg.keys()]);

  const consistencyGroups = [];
  for (const cgId of allCgIds) {
    const cgPairs = pairsByCg.get(cgId) || [];
    const cgJournals = journalsByCg.get(cgId) || [];

    // Calculate volume count: prefer pair count, fall back to journal numOfLdevs
    let volumeCount = cgPairs.length;
    if (volumeCount === 0 && cgJournals.length > 0) {
      // Sum numOfLdevs across all journals in this CG
      volumeCount = cgJournals.reduce((sum, j) => sum + (j.numOfLdevs || 0), 0);
      if (volumeCount > 0) {
        console.log(
          `[discovery] CG-${cgId}: Volume count from journal numOfLdevs: ${volumeCount}`
        );
      }
    }

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

    // Collect unique remote storage device IDs
    const remoteStorageIds = new Set();
    for (const pair of cgPairs) {
      if (pair.remoteStorageDeviceId) {
        remoteStorageIds.add(pair.remoteStorageDeviceId);
      }
    }

    consistencyGroups.push({
      consistencyGroupId: cgId,
      overallStatus,
      volumeCount,
      journalCount: cgJournals.length,
      volumes: cgPairs,
      journals: cgJournals,
      remoteStorageIds: Array.from(remoteStorageIds),
    });
  }

  consistencyGroups.sort((a, b) => a.consistencyGroupId - b.consistencyGroupId);

  console.log(
    `[discovery] Discovered ${consistencyGroups.length} consistency group(s) ` +
    `on storage ${storageDeviceId}.`
  );

  return consistencyGroups;
}

// ---------------------------------------------------------------------------
// Protector-based Discovery
// ---------------------------------------------------------------------------

/**
 * Attempts to discover replication pairs via Ops Center Protector.
 * Returns null if Protector is not configured or discovery fails.
 */
async function discoverViaProtector() {
  const apiConfig = getApiConfig();
  if (!apiConfig) return null;

  const protectorCreds = getProtectorCredentials(apiConfig);
  if (!protectorCreds) {
    console.log('[discovery] Protector not configured, skipping Protector discovery.');
    return null;
  }

  try {
    console.log('[discovery] Attempting Protector-based discovery...');

    const token = await protectorApi.authenticate(
      apiConfig.protectorHost,
      apiConfig.protectorPort,
      protectorCreds.username,
      protectorCreds.password,
      apiConfig.acceptSelfSigned
    );

    const results = await protectorApi.discoverReplication(
      apiConfig.protectorHost,
      apiConfig.protectorPort,
      token,
      apiConfig.acceptSelfSigned
    );

    console.log(
      `[discovery] Protector discovery: method=${results.discoveryMethod}, ` +
      `nodes=${results.nodes.length}, pairs=${results.pairs.length}, ` +
      `copyGroups=${results.copyGroups.length}`
    );

    return results;
  } catch (err) {
    console.warn('[discovery] Protector discovery failed:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Saves discovered volume/pair details to the cg_volumes table.
 */
function saveVolumeDetails(sourceStorageId, consistencyGroupId, volumes) {
  const db = getDb();

  // Clear old volumes for this CG+source combination
  db.prepare(
    'DELETE FROM cg_volumes WHERE cg_id = ? AND source_storage_id = ?'
  ).run(consistencyGroupId, sourceStorageId);

  if (volumes.length === 0) return;

  const insert = db.prepare(`
    INSERT INTO cg_volumes (cg_id, source_storage_id, pvol_ldev_id, svol_ldev_id,
      pvol_journal_id, svol_journal_id, pvol_status, svol_status,
      fence_level, copy_group_name, copy_progress_rate, target_storage_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((vols) => {
    for (const v of vols) {
      insert.run(
        consistencyGroupId,
        sourceStorageId,
        v.pvolLdevId ?? null,
        v.svolLdevId ?? null,
        v.pvolJournalId ?? null,
        v.svolJournalId ?? null,
        v.pvolStatus ?? null,
        v.svolStatus ?? null,
        v.fenceLevel ?? null,
        v.copyGroupName ?? null,
        v.copyProgressRate ?? null,
        v.remoteStorageDeviceId ?? null
      );
    }
  });

  insertMany(volumes);
}

/**
 * Saves consistency groups to the database, including volume count and details.
 */
function saveConsistencyGroups(sourceStorageId, groups) {
  const db = getDb();

  const saveGroup = db.transaction((groups) => {
    for (const group of groups) {
      const targetStorageId = group.remoteStorageIds?.[0] || sourceStorageId;

      const existing = db.prepare(
        `SELECT id FROM consistency_groups
         WHERE cg_id = ? AND source_storage_id = ?`
      ).get(group.consistencyGroupId, sourceStorageId);

      if (existing) {
        db.prepare(
          `UPDATE consistency_groups SET
             name = ?, target_storage_id = ?, volume_count = ?, is_monitored = 1
           WHERE id = ?`
        ).run(
          `CG-${group.consistencyGroupId}`,
          targetStorageId,
          group.volumeCount || 0,
          existing.id
        );
      } else {
        db.prepare(
          `INSERT INTO consistency_groups (cg_id, name, source_storage_id, target_storage_id, volume_count, is_monitored)
           VALUES (?, ?, ?, ?, ?, 1)`
        ).run(
          group.consistencyGroupId,
          `CG-${group.consistencyGroupId}`,
          sourceStorageId,
          targetStorageId,
          group.volumeCount || 0
        );
      }

      // Save volume/pair details
      if (group.volumes && group.volumes.length > 0) {
        saveVolumeDetails(sourceStorageId, group.consistencyGroupId, group.volumes);
      }
    }
  });

  saveGroup(groups);

  console.log(
    `[discovery] Saved ${groups.length} consistency group(s) for ${sourceStorageId}.`
  );
}

// ---------------------------------------------------------------------------
// Full Discovery Orchestration
// ---------------------------------------------------------------------------

/**
 * Runs full discovery:
 * 1. Try Protector-based discovery first (if configured)
 * 2. Then run Configuration Manager discovery for each authenticated storage
 * 3. Merge results and save to database
 */
async function runFullDiscovery() {
  console.log('[discovery] Starting full 3DC environment discovery...');

  const storages = await discoverStorages();

  const db = getDb();
  const authenticatedStorages = db.prepare(
    'SELECT storage_device_id FROM storage_credentials WHERE is_authenticated = 1'
  ).all().map((row) => row.storage_device_id);

  const results = {
    storages,
    authenticatedCount: authenticatedStorages.length,
    consistencyGroups: {},
    protectorResults: null,
    errors: [],
  };

  // Step 1: Try Protector discovery
  const protectorData = await discoverViaProtector();
  if (protectorData) {
    results.protectorResults = {
      discoveryMethod: protectorData.discoveryMethod,
      nodesFound: protectorData.nodes.length,
      pairsFound: protectorData.pairs.length,
      copyGroupsFound: protectorData.copyGroups.length,
    };
  }

  // Step 2: Run Configuration Manager discovery for each authenticated storage
  for (const storageId of authenticatedStorages) {
    try {
      const groups = await discoverConsistencyGroups(storageId);
      results.consistencyGroups[storageId] = groups;

      // Save to database
      if (groups.length > 0) {
        saveConsistencyGroups(storageId, groups);
      }
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
  discoverViaProtector,
  saveConsistencyGroups,
  saveVolumeDetails,
  runFullDiscovery,
};
