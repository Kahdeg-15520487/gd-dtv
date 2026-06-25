export interface DriveEntry {
  filename: string;
  fullPath: string;
  isDir: boolean;
  fileId?: string;
  size?: number;
  mtime?: string;
}

export interface GDriveConfig {
  rootFolderId: string;
  resourceKey: string;
  downloadDir: string;
  maxConcurrency: number;
  lastChangeToken: string;
  db: DbConfig;
}

export interface DriveFolder {
  id: string;
  name: string;
  parentId: string | null;
}

/** Raw entry from rclone lsjson output */
export interface DriveLsEntry {
  Path: string;
  Name: string;
  Size: number;
  ModTime: string;
  IsDir: boolean;
  ID: string;
}

/** A single change from Google Drive changes.list API */
export interface ChangeItem {
  fileId: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  removed: boolean;
  size?: string;
  modifiedTime?: string;
}

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface SearchResult {
  id: number;
  filename: string;
  fullPath: string;
  folder: string;
  extension: string;
  size: number | null;
  mtime: string | null;
  score: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
  limit: number;
  offset: number;
}

export interface FormatCount {
  extension: string;
  count: number;
}

export interface SearchSession {
  query: string;
  results: SearchResult[];
  timestamp: number;
}
