-- Vanguard IPTV Studio — Reference PostgreSQL + RLS Migration (Supabase-compatible)
-- Note: Live runtime database tables are managed via Drizzle ORM in src/db/schema.ts.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Row Level Security Policies Template
ALTER TABLE IF EXISTS playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS playlist_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS channel_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS device_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS device_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_logs ENABLE ROW LEVEL SECURITY;

-- Administrators only manage IPTV configurations
CREATE POLICY admin_full_access_playlists ON playlists
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.uid = auth.uid()::text AND admin_users.is_active = true
    )
  );

-- Devices can never read admin_users or audit_logs; they synchronize only via scoped Edge/API tokens
CREATE POLICY deny_device_admin_users ON admin_users
  FOR SELECT USING (
    auth.uid()::text = uid OR EXISTS (
      SELECT 1 FROM admin_users au WHERE au.uid = auth.uid()::text AND au.role = 'super_admin'
    )
  );
