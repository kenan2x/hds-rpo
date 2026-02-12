const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'rpo-monitor.db');

let db = null;

/**
 * Returns the singleton database instance, creating it if necessary.
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Initializes the SQLite database: creates the data directory if missing,
 * opens the connection, enables WAL mode, and creates all tables.
 * Seeds the default admin user on first run.
 */
function initDatabase() {
  // Ensure the data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  seedDefaults();

  console.log(`[database] SQLite database initialized at ${DB_PATH}`);

  return db;
}

/**
 * Creates all required tables if they do not already exist.
 */
function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 23451,
      use_ssl INTEGER NOT NULL DEFAULT 1,
      accept_self_signed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS storage_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storage_device_id TEXT NOT NULL UNIQUE,
      model TEXT,
      serial_number TEXT,
      username TEXT,
      encrypted_password TEXT,
      iv TEXT,
      auth_tag TEXT,
      is_authenticated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS consistency_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cg_id INTEGER NOT NULL,
      name TEXT,
      source_storage_id TEXT NOT NULL,
      target_storage_id TEXT NOT NULL,
      is_monitored INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rpo_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cg_id INTEGER NOT NULL,
      journal_id INTEGER,
      mu_number INTEGER,
      usage_rate INTEGER,
      q_count INTEGER,
      q_marker TEXT,
      pending_data_bytes INTEGER,
      estimated_rpo_seconds REAL,
      block_delta_bytes INTEGER,
      copy_speed INTEGER,
      journal_status TEXT,
      pair_status TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cg_id INTEGER,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      is_acknowledged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cg_volumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cg_id INTEGER NOT NULL,
      source_storage_id TEXT NOT NULL,
      pvol_ldev_id INTEGER,
      svol_ldev_id INTEGER,
      pvol_journal_id INTEGER,
      svol_journal_id INTEGER,
      pvol_status TEXT,
      svol_status TEXT,
      fence_level TEXT,
      copy_group_name TEXT,
      copy_progress_rate INTEGER,
      target_storage_id TEXT,
      discovered_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Create indexes for frequently queried columns
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rpo_history_cg_id ON rpo_history(cg_id);
    CREATE INDEX IF NOT EXISTS idx_rpo_history_timestamp ON rpo_history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_rpo_history_cg_timestamp ON rpo_history(cg_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_cg_id ON alerts(cg_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);
    CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
    CREATE INDEX IF NOT EXISTS idx_cg_volumes_cg_id ON cg_volumes(cg_id);
  `);

  // Add columns to existing tables if they don't exist (migration)
  const migrations = [
    'ALTER TABLE consistency_groups ADD COLUMN volume_count INTEGER DEFAULT 0',
    'ALTER TABLE api_config ADD COLUMN protector_host TEXT',
    'ALTER TABLE api_config ADD COLUMN protector_port INTEGER DEFAULT 20964',
    'ALTER TABLE api_config ADD COLUMN protector_username TEXT',
    'ALTER TABLE api_config ADD COLUMN protector_encrypted_password TEXT',
    'ALTER TABLE api_config ADD COLUMN protector_iv TEXT',
    'ALTER TABLE api_config ADD COLUMN protector_auth_tag TEXT',
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_e) { /* column already exists */ }
  }
}

/**
 * Seeds the default admin user and default settings on first run.
 */
function seedDefaults() {
  // Seed default admin user if no users exist
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count === 0) {
    const passwordHash = bcrypt.hashSync('admin', 10);
    db.prepare(
      `INSERT INTO users (username, password_hash, must_change_password)
       VALUES (?, ?, 1)`
    ).run('admin', passwordHash);
    console.log('[database] Default admin user created (admin/admin). Password change required on first login.');
  }

  // Seed default settings if settings table is empty
  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get();
  if (settingsCount.count === 0) {
    const defaultSettings = [
      ['polling_interval_seconds', '300'],      // 5 minutes
      ['session_timeout_minutes', '30'],         // 30 minutes UI session
      ['data_retention_days', '30'],             // 30 days raw data retention
      ['rpo_threshold_warning_percent', '5'],    // usageRate warning threshold
      ['rpo_threshold_critical_percent', '20'],  // usageRate critical threshold
      ['auto_refresh_enabled', 'true'],
    ];

    const insertSetting = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?)'
    );

    const insertMany = db.transaction((settings) => {
      for (const [key, value] of settings) {
        insertSetting.run(key, value);
      }
    });

    insertMany(defaultSettings);
    console.log('[database] Default settings seeded.');
  }
}

/**
 * Closes the database connection gracefully.
 */
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('[database] Database connection closed.');
  }
}

module.exports = {
  getDb,
  initDatabase,
  closeDatabase,
};
