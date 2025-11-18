-- =============================================
-- SUPABASE SQL SCHEMA FOR ANIME NIGHT TOURNAMENT
-- =============================================
-- Copy and paste this entire file into Supabase SQL Editor
-- Run the script to create all tables and enable real-time

-- 1. Create tournaments table
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Anime Night Tournament',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- 2. Create bracket_state table (stores the actual bracket data)
CREATE TABLE IF NOT EXISTS bracket_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  players_text TEXT,
  bracket_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT DEFAULT 'system'
);

-- 3. Create admin_codes table (stores valid admin access codes)
CREATE TABLE IF NOT EXISTS admin_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE
);

-- 4. Create audit log for tracking changes (optional but recommended)
CREATE TABLE IF NOT EXISTS bracket_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'generate', 'advance_winner', 'add_player', etc.
  admin_code TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Insert default tournament
INSERT INTO tournaments (name, is_active)
VALUES ('Anime Night Tournament', TRUE)
ON CONFLICT DO NOTHING;

-- 6. Insert sample admin codes (CHANGE THESE TO YOUR OWN CODES!)
INSERT INTO admin_codes (code, description, is_active)
VALUES 
  ('ADMIN2025', 'Main admin access code', TRUE),
  ('TEAMLEAD', 'Team lead access code', TRUE),
  ('MODERATOR', 'Moderator access code', TRUE)
ON CONFLICT (code) DO NOTHING;

-- 7. Enable Row Level Security (RLS)
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bracket_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bracket_audit_log ENABLE ROW LEVEL SECURITY;

-- 8. Create policies for public read access
CREATE POLICY "Allow public read on tournaments"
  ON tournaments FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "Allow public read on bracket_state"
  ON bracket_state FOR SELECT
  TO anon, authenticated
  USING (TRUE);

-- 9. Create policies for admin write access (anyone can write for now - you can add auth later)
CREATE POLICY "Allow all inserts on bracket_state"
  ON bracket_state FOR INSERT
  TO anon, authenticated
  WITH CHECK (TRUE);

CREATE POLICY "Allow all updates on bracket_state"
  ON bracket_state FOR UPDATE
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "Allow public read on admin_codes"
  ON admin_codes FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "Allow public read on audit_log"
  ON bracket_audit_log FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "Allow all inserts on audit_log"
  ON bracket_audit_log FOR INSERT
  TO anon, authenticated
  WITH CHECK (TRUE);

-- 10. Create function to update timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 11. Create trigger for auto-updating timestamp
CREATE TRIGGER update_bracket_state_updated_at
  BEFORE UPDATE ON bracket_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tournaments_updated_at
  BEFORE UPDATE ON tournaments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 12. Enable Realtime for bracket_state table
-- Note: You also need to enable Realtime in Supabase Dashboard > Database > Replication
-- Add 'bracket_state' table to the publication
ALTER PUBLICATION supabase_realtime ADD TABLE bracket_state;

-- =============================================
-- SETUP COMPLETE!
-- =============================================
-- Next steps:
-- 1. Go to Supabase Dashboard > Database > Replication
-- 2. Enable replication for 'bracket_state' table
-- 3. Copy your Supabase URL and anon key to .env file
-- 4. Update admin codes above to your own secure codes
-- =============================================
