/**
 * Hitachi RPO Monitor - Data Formatting Helpers
 * All user-facing strings are in Turkish.
 */

// --- Byte Formatting ---

/**
 * Format a byte count into a human-readable string (e.g., "1.5 GB", "3.87 TB").
 * @param {number} bytes
 * @param {number} decimals - decimal places (default 2)
 * @returns {string}
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  const value = bytes / Math.pow(k, index);

  return `${value.toFixed(decimals)} ${sizes[index]}`;
}

// --- Duration Formatting (Turkish) ---

/**
 * Format seconds into a Turkish duration string.
 * Examples: "2 saat 15 dk", "45 sn", "3 gün 5 saat"
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '—';
  if (seconds < 0) return '—';

  const s = Math.round(seconds);

  if (s < 60) {
    return `${s} sn`;
  }

  const minutes = Math.floor(s / 60);
  const remainingSeconds = s % 60;

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes} dk ${remainingSeconds} sn`
      : `${minutes} dk`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return remainingMinutes > 0
      ? `${hours} saat ${remainingMinutes} dk`
      : `${hours} saat`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return remainingHours > 0
    ? `${days} gun ${remainingHours} saat`
    : `${days} gun`;
}

/**
 * Format seconds into a short Turkish duration (compact, for gauge display).
 * Examples: "~2s 15dk", "~45sn", "~3g"
 * @param {number} seconds
 * @returns {string}
 */
export function formatDurationShort(seconds) {
  if (seconds == null || isNaN(seconds)) return '—';
  if (seconds < 0) return '—';

  const s = Math.round(seconds);

  if (s < 60) return `~${s}sn`;

  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `~${minutes}dk`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0
      ? `~${hours}s ${remainingMinutes}dk`
      : `~${hours}s`;
  }

  const days = Math.floor(hours / 24);
  return `~${days}g`;
}

// --- Number Formatting (Turkish locale uses dot as thousands separator) ---

/**
 * Format a number with Turkish thousand separators (dot).
 * Example: 1465528 → "1.465.528"
 * @param {number} num
 * @returns {string}
 */
export function formatNumber(num) {
  if (num == null || isNaN(num)) return '—';
  return num.toLocaleString('tr-TR');
}

// --- Timestamp Formatting ---

/**
 * Format an ISO timestamp string into a Turkish-readable display.
 * If same day: "14:30:25"
 * If different day: "12 Sub 14:30"
 * @param {string|Date} isoString
 * @returns {string}
 */
export function formatTimestamp(isoString) {
  if (!isoString) return '—';

  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '—';

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  if (isToday) {
    return `${hours}:${minutes}:${seconds}`;
  }

  const months = [
    'Oca', 'Sub', 'Mar', 'Nis', 'May', 'Haz',
    'Tem', 'Agu', 'Eyl', 'Eki', 'Kas', 'Ara',
  ];
  const day = date.getDate();
  const month = months[date.getMonth()];

  return `${day} ${month} ${hours}:${minutes}`;
}

/**
 * Format a timestamp for chart axis labels.
 * @param {string|Date|number} timestamp
 * @param {'1h'|'6h'|'24h'|'7d'} timeframe
 * @returns {string}
 */
export function formatChartTime(timestamp, timeframe) {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  if (timeframe === '7d') {
    const day = date.getDate();
    const months = [
      'Oca', 'Sub', 'Mar', 'Nis', 'May', 'Haz',
      'Tem', 'Agu', 'Eyl', 'Eki', 'Kas', 'Ara',
    ];
    return `${day} ${months[date.getMonth()]}`;
  }

  return `${hours}:${minutes}`;
}

// --- Parse Hitachi Byte Format ---

/**
 * Parse a Hitachi API byte format string to bytes.
 * Examples: "3.87 T" → 3.87 * 1024^4, "500 G" → 500 * 1024^3
 * @param {string} str - e.g., "3.87 T", "500 G", "100 M"
 * @returns {number} bytes
 */
export function parseByteFormat(str) {
  if (!str || typeof str !== 'string') return 0;

  const match = str.trim().match(/^([\d.]+)\s*([TGMKB])/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const multipliers = {
    B: 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
  };

  return value * (multipliers[unit] || 1);
}

// --- Status Color Mapping ---

/**
 * Journal status → severity/color mapping.
 */
const JOURNAL_STATUS_MAP = {
  SMPL: { color: 'gray', severity: 'info', label: 'Kullanilmiyor' },
  PJNN: { color: 'green', severity: 'ok', label: 'Normal' },
  SJNN: { color: 'green', severity: 'ok', label: 'Normal' },
  PJSN: { color: 'yellow', severity: 'warning', label: 'Normal Ayrilmis' },
  SJSN: { color: 'yellow', severity: 'warning', label: 'Normal Ayrilmis' },
  PJNF: { color: 'orange', severity: 'high', label: 'Journal Dolu' },
  SJNF: { color: 'orange', severity: 'high', label: 'Journal Dolu' },
  PJSF: { color: 'red', severity: 'critical', label: 'Journal Dolu + Ayrilmis' },
  SJSF: { color: 'red', severity: 'critical', label: 'Journal Dolu + Ayrilmis' },
  PJSE: { color: 'red', severity: 'critical', label: 'Hata Ayrilmis (Baglanti)' },
  SJSE: { color: 'red', severity: 'critical', label: 'Hata Ayrilmis (Baglanti)' },
  PJNS: { color: 'yellow', severity: 'warning', label: 'Normal Ayrilmis (3DC Delta)' },
  SJNS: { color: 'yellow', severity: 'warning', label: 'Normal Ayrilmis (3DC Delta)' },
  PJES: { color: 'red', severity: 'critical', label: 'Hata Ayrilmis (3DC Delta)' },
  SJES: { color: 'red', severity: 'critical', label: 'Hata Ayrilmis (3DC Delta)' },
};

/**
 * Pair status → severity/color mapping.
 */
const PAIR_STATUS_MAP = {
  PAIR: { color: 'green', severity: 'ok', label: 'Normal Replikasyon' },
  COPY: { color: 'blue', severity: 'info', label: 'Senkronizasyon' },
  PSUS: { color: 'yellow', severity: 'warning', label: 'Birincil Askida' },
  SSUS: { color: 'yellow', severity: 'warning', label: 'Ikincil Askida' },
  PSUE: { color: 'red', severity: 'critical', label: 'Hata - Askiya Alindi' },
  SSWS: { color: 'orange', severity: 'high', label: 'DR Aktif (Yazilabilir)' },
};

/**
 * Color name → Tailwind classes mapping.
 */
const COLOR_CLASSES = {
  green: {
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    border: 'border-green-500',
    ring: 'ring-green-500/30',
  },
  yellow: {
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-400',
    border: 'border-yellow-500',
    ring: 'ring-yellow-500/30',
  },
  orange: {
    bg: 'bg-orange-500/10',
    text: 'text-orange-400',
    border: 'border-orange-500',
    ring: 'ring-orange-500/30',
  },
  red: {
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500',
    ring: 'ring-red-500/30',
  },
  blue: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500',
    ring: 'ring-blue-500/30',
  },
  gray: {
    bg: 'bg-gray-500/20',
    text: 'text-gray-400',
    border: 'border-gray-500',
    ring: 'ring-gray-500/30',
  },
};

/**
 * Get Tailwind color classes for a given status.
 * @param {string} status - e.g. "PJNN", "PAIR"
 * @param {'journal'|'pair'} type
 * @returns {{ bg: string, text: string, border: string, ring: string }}
 */
export function getStatusColor(status, type = 'journal') {
  const map = type === 'pair' ? PAIR_STATUS_MAP : JOURNAL_STATUS_MAP;
  const entry = map[status];
  const colorName = entry ? entry.color : 'gray';
  return COLOR_CLASSES[colorName] || COLOR_CLASSES.gray;
}

/**
 * Get the raw color name for a status.
 * @param {string} status
 * @param {'journal'|'pair'} type
 * @returns {string} - 'green', 'yellow', 'orange', 'red', 'blue', 'gray'
 */
export function getStatusColorName(status, type = 'journal') {
  const map = type === 'pair' ? PAIR_STATUS_MAP : JOURNAL_STATUS_MAP;
  const entry = map[status];
  return entry ? entry.color : 'gray';
}

/**
 * Get the Turkish label for a status.
 * @param {string} status
 * @param {'journal'|'pair'} type
 * @returns {string}
 */
export function getStatusLabel(status, type = 'journal') {
  const map = type === 'pair' ? PAIR_STATUS_MAP : JOURNAL_STATUS_MAP;
  const entry = map[status];
  return entry ? entry.label : status || '—';
}

/**
 * Get the severity string for a status.
 * @param {string} status
 * @param {'journal'|'pair'} type
 * @returns {string} - 'ok', 'info', 'warning', 'high', 'critical'
 */
export function getStatusSeverity(status, type = 'journal') {
  const map = type === 'pair' ? PAIR_STATUS_MAP : JOURNAL_STATUS_MAP;
  const entry = map[status];
  return entry ? entry.severity : 'info';
}

// --- Trend Helpers ---

/**
 * Get a trend direction string based on a trend value.
 * @param {'increasing'|'decreasing'|'stable'|string} trend
 * @returns {{ icon: string, label: string, color: string }}
 */
export function getTrendInfo(trend) {
  switch (trend) {
    case 'increasing':
      return { icon: 'arrow-up', label: 'Artis', color: 'text-red-400' };
    case 'decreasing':
      return { icon: 'arrow-down', label: 'Azalis', color: 'text-green-400' };
    case 'stable':
      return { icon: 'minus', label: 'Sabit', color: 'text-slate-400' };
    default:
      return { icon: 'minus', label: '—', color: 'text-slate-500' };
  }
}

/**
 * Get the Tailwind border color class for usageRate thresholds.
 * @param {number} usageRate - percentage (0-100)
 * @returns {string} Tailwind border class
 */
export function getUsageRateBorderColor(usageRate) {
  if (usageRate == null || isNaN(usageRate)) return 'border-l-slate-600';
  if (usageRate < 5) return 'border-l-green-500';
  if (usageRate <= 20) return 'border-l-yellow-500';
  return 'border-l-red-500';
}

/**
 * Get the color name for a usageRate.
 * @param {number} usageRate
 * @returns {'green'|'yellow'|'red'}
 */
export function getUsageRateColorName(usageRate) {
  if (usageRate == null || isNaN(usageRate)) return 'gray';
  if (usageRate < 5) return 'green';
  if (usageRate <= 20) return 'yellow';
  return 'red';
}

// --- Severity helpers for alerts ---

/**
 * Get alert severity color classes.
 * @param {'info'|'warning'|'critical'} severity
 * @returns {{ bg: string, text: string, icon: string }}
 */
export function getAlertSeverityColor(severity) {
  switch (severity) {
    case 'critical':
      return { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' };
    case 'warning':
      return { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/30' };
    case 'info':
    default:
      return { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30' };
  }
}
