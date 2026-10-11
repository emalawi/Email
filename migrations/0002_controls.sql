-- Smartbase Email Platform: sign-in options, storage routing, account control, broadcasts.
-- Safe to run more than once (only CREATE ... IF NOT EXISTS). Existing tables are not altered.
CREATE TABLE IF NOT EXISTS project_settings (
  project_id TEXT PRIMARY KEY,
  settings TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_secrets (
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enc TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, name)
);
CREATE TABLE IF NOT EXISTS oauth_extra (
  state_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS code_profiles (
  code_hash TEXT PRIMARY KEY,
  profile_enc TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_links (
  project_id TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  end_user_id TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (project_id, device_hash, end_user_id)
);
CREATE INDEX IF NOT EXISTS idx_device_links_user ON device_links (project_id, end_user_id);
CREATE TABLE IF NOT EXISTS account_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  device_hash TEXT,
  end_user_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gateway_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_enc TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id TEXT PRIMARY KEY,
  broadcast_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  sent_at TEXT,
  opened_at TEXT,
  open_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_bcast_rcpt ON broadcast_recipients (broadcast_id, status);
CREATE TABLE IF NOT EXISTS broadcast_optouts (
  project_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, email)
);
