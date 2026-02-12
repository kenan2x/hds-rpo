/**
 * RPO Calculation Engine
 *
 * Implements two complementary RPO measurement methods for Hitachi 3DC
 * Universal Replicator environments:
 *
 * Method 1 (Primary): Journal-based using qMarker, qCount, and usageRate.
 *   This captures ALL data changes including overwrites to existing blocks.
 *
 * Method 2 (Supplementary): LDEV numOfUsedBlock comparison.
 *   Only detects new block allocations. Useful for initial copy tracking
 *   and storage vMotion, but NOT reliable for general RPO (misses overwrites).
 */

/**
 * Size multipliers for parsing byteFormatCapacity strings from the Hitachi API.
 * The API returns human-readable sizes like "3.87 T", "500 G", "128 M".
 */
const SIZE_MULTIPLIERS = {
  B: 1,
  K: 1024,
  M: 1024 * 1024,
  G: 1024 * 1024 * 1024,
  T: 1024 * 1024 * 1024 * 1024,
  P: 1024 * 1024 * 1024 * 1024 * 1024,
};

/**
 * Parses a Hitachi byteFormatCapacity string (e.g., "3.87 T") into bytes.
 *
 * @param {string} byteFormatCapacity - Formatted capacity string from the API
 * @returns {number} Capacity in bytes, or 0 if parsing fails
 */
function parseByteFormatCapacity(byteFormatCapacity) {
  if (!byteFormatCapacity || typeof byteFormatCapacity !== 'string') {
    return 0;
  }

  const trimmed = byteFormatCapacity.trim();

  // Match patterns like "3.87 T", "500 G", "128 M", "1.5 TB", "500 GB"
  const match = trimmed.match(/^([\d.]+)\s*([BKMGTP])B?$/i);
  if (!match) {
    console.warn(`[rpoCalculator] Could not parse byteFormatCapacity: "${byteFormatCapacity}"`);
    return 0;
  }

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multiplier = SIZE_MULTIPLIERS[unit];

  if (isNaN(value) || !multiplier) {
    return 0;
  }

  return Math.round(value * multiplier);
}

/**
 * Method 1: Calculate journal-based RPO metrics.
 *
 * This is the primary and more accurate RPO method. It uses journal usage
 * data to estimate how much data is pending replication and how long it
 * would take to replicate at the current copy speed.
 *
 * Key metrics:
 * - pendingDataBytes: Approximate amount of unreplicated data in the journal
 * - estimatedRpoSeconds: Time estimate to replicate pending data
 * - qMarkerDelta: Sequence number gap between master and DR journals
 * - usageRate: Journal fill percentage (integer, so precision is coarse)
 *
 * @param {Object} journalData - Journal data from the Hitachi API (basic info)
 * @param {number} journalData.usageRate - Journal usage percentage (integer 0-100)
 * @param {string} journalData.byteFormatCapacity - Total journal capacity (e.g., "3.87 T")
 * @param {number} journalData.qCount - Number of pending entries in the journal
 * @param {string} journalData.qMarker - Hex sequence marker for this journal
 * @param {string} journalData.journalStatus - Current journal status code
 * @param {number} journalData.journalId - Journal ID
 * @param {number} journalData.muNumber - Mirror unit number
 * @param {number} journalData.consistencyGroupId - Consistency group this journal belongs to
 * @param {number} copySpeed - Copy speed in Mbps from journal detail data
 * @param {string} [drQMarker] - qMarker from the DR-side journal (for delta calculation)
 * @returns {Object} Calculated RPO metrics
 */
function calculateJournalRpo(journalData, copySpeed, drQMarker = null) {
  const totalCapacityBytes = parseByteFormatCapacity(journalData.byteFormatCapacity);
  const usageRate = journalData.usageRate || 0;
  const qCount = journalData.qCount || 0;
  const qMarker = journalData.qMarker || '0';

  // Pending data = total capacity * usage percentage
  const pendingDataBytes = Math.round(totalCapacityBytes * usageRate / 100);

  // Estimated RPO time in seconds based on copy speed
  // copySpeed is in Mbps (megabits per second)
  // Convert to bytes per second: Mbps * 1024 * 1024 / 8
  let estimatedRpoSeconds = 0;
  if (copySpeed && copySpeed > 0) {
    const copyBytesPerSecond = (copySpeed * 1024 * 1024) / 8;
    estimatedRpoSeconds = pendingDataBytes / copyBytesPerSecond;
  }

  // qMarker delta: difference between master and DR sequence numbers
  let qMarkerDelta = null;
  if (drQMarker) {
    const masterMarkerDec = parseInt(qMarker, 16);
    const drMarkerDec = parseInt(drQMarker, 16);
    if (!isNaN(masterMarkerDec) && !isNaN(drMarkerDec)) {
      qMarkerDelta = masterMarkerDec - drMarkerDec;
    }
  }

  // Severity classification based on usageRate
  let severity = 'normal';
  if (usageRate >= 20) {
    severity = 'critical';
  } else if (usageRate >= 5) {
    severity = 'warning';
  }

  return {
    journalId: journalData.journalId,
    muNumber: journalData.muNumber,
    consistencyGroupId: journalData.consistencyGroupId,
    journalStatus: journalData.journalStatus,
    usageRate,
    qCount,
    qMarker,
    totalCapacityBytes,
    pendingDataBytes,
    estimatedRpoSeconds: Math.round(estimatedRpoSeconds * 100) / 100,
    qMarkerDelta,
    copySpeed: copySpeed || 0,
    severity,
  };
}

/**
 * Method 2: Calculate block allocation delta between primary and secondary volumes.
 *
 * This is the supplementary method that compares numOfUsedBlock between
 * the primary (P-VOL) and secondary (S-VOL) volumes. It only detects
 * differences in allocated blocks, so it misses data overwrites.
 *
 * Block size is 512 bytes (standard for Hitachi VSP).
 *
 * @param {number} pvolUsedBlocks - numOfUsedBlock for the primary volume
 * @param {number} svolUsedBlocks - numOfUsedBlock for the secondary volume
 * @returns {Object} Block delta metrics
 */
function calculateBlockDelta(pvolUsedBlocks, svolUsedBlocks) {
  const BLOCK_SIZE_BYTES = 512;

  const pvolBlocks = pvolUsedBlocks || 0;
  const svolBlocks = svolUsedBlocks || 0;
  const blockDifference = Math.abs(pvolBlocks - svolBlocks);
  const blockDeltaBytes = blockDifference * BLOCK_SIZE_BYTES;

  return {
    pvolUsedBlocks: pvolBlocks,
    svolUsedBlocks: svolBlocks,
    blockDifference,
    blockDeltaBytes,
    // Indicate which side has more allocated blocks
    direction: pvolBlocks > svolBlocks
      ? 'primary_ahead'
      : pvolBlocks < svolBlocks
        ? 'secondary_ahead'
        : 'equal',
  };
}

/**
 * Aggregates RPO data across multiple volumes in a consistency group.
 * Uses worst-case (maximum) values to represent the group's RPO.
 *
 * @param {Array<Object>} volumeRpos - Array of per-volume RPO objects from calculateJournalRpo
 * @returns {Object} Aggregated group-level RPO metrics
 */
function aggregateGroupRpo(volumeRpos) {
  if (!volumeRpos || volumeRpos.length === 0) {
    return {
      volumeCount: 0,
      worstUsageRate: 0,
      totalPendingDataBytes: 0,
      worstEstimatedRpoSeconds: 0,
      totalQCount: 0,
      worstSeverity: 'normal',
      volumes: [],
    };
  }

  let worstUsageRate = 0;
  let worstEstimatedRpoSeconds = 0;
  let totalPendingDataBytes = 0;
  let totalQCount = 0;
  let worstSeverity = 'normal';

  const severityOrder = { normal: 0, warning: 1, critical: 2 };

  for (const vol of volumeRpos) {
    if (vol.usageRate > worstUsageRate) {
      worstUsageRate = vol.usageRate;
    }

    if (vol.estimatedRpoSeconds > worstEstimatedRpoSeconds) {
      worstEstimatedRpoSeconds = vol.estimatedRpoSeconds;
    }

    totalPendingDataBytes += vol.pendingDataBytes || 0;
    totalQCount += vol.qCount || 0;

    if (severityOrder[vol.severity] > severityOrder[worstSeverity]) {
      worstSeverity = vol.severity;
    }
  }

  return {
    volumeCount: volumeRpos.length,
    worstUsageRate,
    totalPendingDataBytes,
    worstEstimatedRpoSeconds,
    totalQCount,
    worstSeverity,
    volumes: volumeRpos,
  };
}

/**
 * Determines the RPO trend by analyzing historical qCount values.
 *
 * Compares recent qCount readings to determine if the replication backlog
 * is increasing, decreasing, or stable. Uses a simple linear regression
 * approach over the last N data points.
 *
 * @param {Array<number>} historicalQCounts - Array of qCount values ordered chronologically (oldest first)
 * @param {number} [threshold=0.05] - Percentage change threshold to consider trend significant
 * @returns {{ trend: 'increasing'|'decreasing'|'stable', changeRate: number, dataPoints: number }}
 */
function determineTrend(historicalQCounts, threshold = 0.05) {
  if (!historicalQCounts || historicalQCounts.length < 2) {
    return {
      trend: 'stable',
      changeRate: 0,
      dataPoints: historicalQCounts ? historicalQCounts.length : 0,
    };
  }

  const n = historicalQCounts.length;

  // Simple linear regression: compute slope
  // x values are indices 0..n-1, y values are qCounts
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += historicalQCounts[i];
    sumXY += i * historicalQCounts[i];
    sumXX += i * i;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    return { trend: 'stable', changeRate: 0, dataPoints: n };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;

  // Normalize slope relative to the mean qCount to get a rate of change
  const meanQCount = sumY / n;
  const changeRate = meanQCount > 0 ? slope / meanQCount : 0;

  let trend;
  if (changeRate > threshold) {
    trend = 'increasing';
  } else if (changeRate < -threshold) {
    trend = 'decreasing';
  } else {
    trend = 'stable';
  }

  return {
    trend,
    changeRate: Math.round(changeRate * 10000) / 10000, // 4 decimal places
    dataPoints: n,
  };
}

/**
 * Formats a byte count into a human-readable string.
 *
 * @param {number} bytes
 * @returns {string} Formatted string (e.g., "232.5 GB", "1.2 TB")
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const k = 1024;
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  const index = Math.min(i, units.length - 1);

  return `${(bytes / Math.pow(k, index)).toFixed(2)} ${units[index]}`;
}

/**
 * Formats seconds into a human-readable duration string.
 *
 * @param {number} seconds
 * @returns {string} Formatted duration (e.g., "2 saat 4 dk", "45 dk", "30 sn")
 */
function formatDuration(seconds) {
  if (seconds < 60) {
    return `${Math.round(seconds)} sn`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours} saat ${minutes} dk` : `${hours} saat`;
  }

  return `${minutes} dk`;
}

module.exports = {
  parseByteFormatCapacity,
  calculateJournalRpo,
  calculateBlockDelta,
  aggregateGroupRpo,
  determineTrend,
  formatBytes,
  formatDuration,
};
