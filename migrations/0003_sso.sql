-- Single sign-in from Smartbase. Safe to run more than once.
CREATE TABLE IF NOT EXISTS sso_accounts (smart_user_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sso_used (jti TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
