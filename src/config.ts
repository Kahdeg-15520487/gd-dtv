import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GDriveConfig, DbConfig } from './types';

const CONFIG_DIR = path.join(os.homedir(), '.gdrive-cli');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: GDriveConfig = {
  rootFolderId: '',
  resourceKey: '',
  downloadDir: path.join(os.homedir(), 'Downloads', 'gdrive'),
  maxConcurrency: 3,
  lastChangeToken: '',
  db: {
    host: 'localhost',
    port: 5434,
    database: 'gdrive',
    user: 'gdrive',
    password: 'gdrive',
  },
};

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): GDriveConfig {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<GDriveConfig>;
  const merged: GDriveConfig = {
    ...DEFAULT_CONFIG,
    ...parsed,
    db: { ...DEFAULT_CONFIG.db, ...(parsed.db || {}) },
  };
  return merged;
}

export function saveConfig(config: GDriveConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function updateConfig(partial: Partial<GDriveConfig>): GDriveConfig {
  const current = loadConfig();
  const updated: GDriveConfig = { ...current, ...partial };
  if (partial.db) {
    updated.db = { ...current.db, ...partial.db };
  }
  saveConfig(updated);
  return updated;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
