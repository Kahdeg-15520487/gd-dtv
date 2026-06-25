CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS drive_files (
  id        SERIAL PRIMARY KEY,
  file_id   TEXT UNIQUE,
  filename  TEXT NOT NULL,
  full_path TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_drive_files_file_id
  ON drive_files (file_id);

CREATE INDEX IF NOT EXISTS idx_drive_folders_parent_id
  ON drive_folders (parent_id);
