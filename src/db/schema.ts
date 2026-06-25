import { getPool } from './client';

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS drive_files (
  id        SERIAL PRIMARY KEY,
  file_id   TEXT UNIQUE,
  filename  TEXT NOT NULL,
  full_path TEXT NOT NULL,
  size      BIGINT,
  mtime     TIMESTAMPTZ,
  is_dir    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS drive_folders (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  parent_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_drive_files_filename_trgm
  ON drive_files USING GIN (filename gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_drive_files_fullpath_trgm
  ON drive_files USING GIN (full_path gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_drive_files_is_dir
  ON drive_files (is_dir);

CREATE INDEX IF NOT EXISTS idx_drive_folders_parent_id
  ON drive_folders (parent_id);
`;

const MIGRATION_SQL = `
-- Add file_id column to existing drive_files table if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drive_files' AND column_name = 'file_id'
  ) THEN
    ALTER TABLE drive_files ADD COLUMN file_id TEXT;
    ALTER TABLE drive_files ADD CONSTRAINT drive_files_file_id_unique UNIQUE (file_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_drive_files_file_id ON drive_files (file_id);

-- Add size column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drive_files' AND column_name = 'size'
  ) THEN
    ALTER TABLE drive_files ADD COLUMN size BIGINT;
  END IF;
END $$;

-- Add mtime column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'drive_files' AND column_name = 'mtime'
  ) THEN
    ALTER TABLE drive_files ADD COLUMN mtime TIMESTAMPTZ;
  END IF;
END $$;

-- Create drive_folders table if missing
CREATE TABLE IF NOT EXISTS drive_folders (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  parent_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_drive_folders_parent_id ON drive_folders (parent_id);
`;

export async function createSchema(): Promise<void> {
  const pool = getPool();
  await pool.query(SCHEMA_SQL);
  await pool.query(MIGRATION_SQL);
}

export async function truncateFiles(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM drive_files');
  try {
    await pool.query('DELETE FROM drive_folders');
  } catch {
    // drive_folders table may not exist yet
  }
}
