import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, updateConfig } from '../config';
import { createPool, closePool } from '../db/client';
import { truncateFiles } from '../db/schema';
import { bulkInsertFiles, upsertFolders, countFiles, countDirs } from '../db/queries';
import { DriveEntry, DriveFolder, DriveLsEntry } from '../types';

const BATCH_SIZE = 5000;
const CACHE_DIR = path.join(os.homedir(), '.gdrive-cli');
const CACHE_PATH = path.join(CACHE_DIR, 'lsjson-cache.json');

function fetchLsjson(config: ReturnType<typeof loadConfig>): DriveLsEntry[] {
  // Check cache first
  if (fs.existsSync(CACHE_PATH)) {
    const stat = fs.statSync(CACHE_PATH);
    const age = (Date.now() - stat.mtimeMs) / 1000 / 60;
    console.log(`Using cached listing from ${Math.round(age)} min ago: ${CACHE_PATH}`);
    console.log('(delete the cache to force a fresh fetch)\n');
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) as DriveLsEntry[];
  }

  console.log('Fetching file listing via rclone lsjson (this may take a few minutes)...');

  const args: string[] = [
    'lsjson', 'gdrive-dtv:',
    '--recursive',
    '--drive-root-folder-id', config.rootFolderId,
    '--drive-resource-key', config.resourceKey,
    '--no-mimetype',
  ];

  const stdout = execFileSync('rclone', args, {
    encoding: 'utf-8',
    maxBuffer: 500 * 1024 * 1024,
  });

  // Cache to disk
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  fs.writeFileSync(CACHE_PATH, stdout, 'utf-8');
  console.log(`Cached to ${CACHE_PATH}\n`);

  return JSON.parse(stdout) as DriveLsEntry[];
}

export async function importCommand(): Promise<void> {
  const config = loadConfig();

  if (!config.rootFolderId) {
    console.error('ERROR: rootFolderId not configured.');
    console.error('Run: gd config set rootFolderId "<id>"');
    process.exit(1);
  }

  console.log('GDrive CLI — Import\n');

  // Connect to database
  createPool(config.db);

  // Warn if no cache — full fetch will be slow
  if (!fs.existsSync(CACHE_PATH)) {
    const readline = (await import('readline')).default;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>(resolve => {
      rl.question('No cache found. Full fetch from Google Drive will take ~15 min. Continue? [y/N] ', resolve);
    });
    rl.close();
    if (answer.toLowerCase() !== 'y') {
      console.log('Import cancelled.');
      await closePool();
      return;
    }
  }

  // Check for existing data and confirm
  const existing = await countFiles();
  if (existing > 0) {
    const readline = (await import('readline')).default;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>(resolve => {
      rl.question(`Database has ${existing.toLocaleString()} files. Replace with fresh import? [y/N] `, resolve);
    });
    rl.close();
    if (answer.toLowerCase() !== 'y') {
      console.log('Import cancelled.');
      await closePool();
      return;
    }
  }

  // Clear existing data
  console.log('Clearing existing data...');
  await truncateFiles();
  console.log('Existing data cleared.\n');

  // Step 1: Fetch listing (from cache or rclone)
  let dirEntries: DriveLsEntry[];
  try {
    dirEntries = fetchLsjson(config);
  } catch (err: any) {
    console.error('ERROR: rclone lsjson failed.');
    if (err.stderr) console.error(err.stderr);
    // Delete bad cache
    try { fs.unlinkSync(CACHE_PATH); } catch {}
    await closePool();
    process.exit(1);
  }

  const dirs = dirEntries.filter(e => e.IsDir);
  const files = dirEntries.filter(e => !e.IsDir);

  console.log(`Found: ${files.length.toLocaleString()} files, ${dirs.length.toLocaleString()} directories\n`);

  // Step 2: Insert folders into drive_folders table
  if (dirs.length > 0) {
    console.log('Indexing folder structure...');
    const folderPathMap = new Map<string, DriveFolder>();
    const folderById = new Map<string, DriveFolder>();

    for (const d of dirs) {
      const pathParts = d.Path.split('/');
      const name = pathParts[pathParts.length - 1];
      const parentPath = pathParts.length > 1
        ? pathParts.slice(0, -1).join('/')
        : null;
      const parentId = parentPath ? folderPathMap.get(parentPath)?.id ?? null : null;

      if (folderById.has(d.ID)) continue;
      const folder: DriveFolder = { id: d.ID, name, parentId };
      folderById.set(d.ID, folder);
      folderPathMap.set(d.Path, folder);
    }

    const folders = Array.from(folderById.values());
    let folderBatch: DriveFolder[] = [];
    for (const f of folders) {
      folderBatch.push(f);
      if (folderBatch.length >= BATCH_SIZE) {
        await upsertFolders(folderBatch.splice(0));
      }
    }
    if (folderBatch.length > 0) {
      await upsertFolders(folderBatch);
    }
    console.log(`  ${folders.length.toLocaleString()} folders indexed.`);
  }

  // Step 3: Insert files into drive_files table
  console.log('\nInserting files into database...');
  let inserted = 0;
  const entries: DriveEntry[] = [];
  const seenFileIds = new Set<string>();

  for (const f of files) {
    if (seenFileIds.has(f.ID)) continue;
    seenFileIds.add(f.ID);

    entries.push({
      filename: f.Name,
      fullPath: '/' + f.Path,
      isDir: false,
      fileId: f.ID,
      size: f.Size,
      mtime: f.ModTime,
    });

    if (entries.length >= BATCH_SIZE) {
      const count = await bulkInsertFiles(entries.splice(0));
      inserted += count;
      const pct = Math.round((inserted / files.length) * 100);
      process.stdout.write(`\r  Progress: ${pct}% (${inserted.toLocaleString()} inserted)...`);
    }
  }
  if (entries.length > 0) {
    inserted += await bulkInsertFiles(entries);
  }
  console.log(`\r  Progress: 100% (${inserted.toLocaleString()} inserted)...`);
  console.log();

  // Step 4: Get and save start page token for future sync
  console.log('Fetching change token for future sync...');
  try {
    const { getAccessToken, getStartPageToken } = await import('../sync/drive-api');
    const at = await getAccessToken();
    const token = await getStartPageToken(at);
    updateConfig({ lastChangeToken: token });
    console.log(`  Change token saved: ${token}`);
  } catch (err: any) {
    console.log(`  Warning: Could not fetch change token: ${err.message}`);
    console.log('  Sync will do a full import on first run.');
  }

  // Success — delete cache
  try { fs.unlinkSync(CACHE_PATH); } catch {}

  // Verify
  const finalFileCount = await countFiles();
  const finalDirCount = await countDirs();
  console.log('\nImport complete!');
  console.log(`  Files:       ${finalFileCount.toLocaleString()}`);
  console.log(`  Directories: ${finalDirCount.toLocaleString()}`);

  await closePool();
}
