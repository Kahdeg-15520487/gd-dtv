import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig } from '../config';
import { createPool, closePool } from '../db/client';
import { getFileById } from '../db/queries';
import { SearchResult } from '../types';

interface DownloadTask {
  file: SearchResult;
  index: number;
  total: number;
}

function downloadSingleFile(
  file: SearchResult,
  config: ReturnType<typeof loadConfig>,
  index: number,
  total: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const destDir = config.downloadDir.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '');
    const destPath = path.join(destDir, file.filename);

    // Ensure download directory exists
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const args = [
      'copy',
      `gdrive-dtv:${file.fullPath}`,
      destPath,
    ];

    // Add drive flags if configured
    if (config.rootFolderId) {
      args.push('--drive-root-folder-id', config.rootFolderId);
    }
    if (config.resourceKey) {
      args.push('--drive-resource-key', config.resourceKey);
    }

    const label = `[${index}/${total}]`;
    console.log(`${label} Downloading: ${file.filename}`);

    const proc = spawn('rclone', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        console.log(`${label} ✓ ${file.filename}`);
        resolve(true);
      } else {
        console.error(`${label} ✗ ${file.filename} (exit code: ${code})`);
        if (stderr.trim()) {
          console.error(`    ${stderr.trim().split('\n').join('\n    ')}`);
        }
        resolve(false);
      }
    });

    proc.on('error', (err: Error) => {
      console.error(`${label} ✗ ${file.filename} (error: ${err.message})`);
      resolve(false);
    });
  });
}

export async function downloadCommand(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    console.error('ERROR: Please provide file IDs to download.');
    console.error('Usage: gd download <id1> [id2] [id3...]');
    console.error('Run "gd search <query>" first to find file IDs.');
    process.exit(1);
  }

  const config = loadConfig();
  console.log(`Download to: ${config.downloadDir}\n`);

  // Parse IDs
  const numericIds: number[] = [];
  for (const idStr of ids) {
    const num = parseInt(idStr, 10);
    if (isNaN(num)) {
      console.error(`Invalid ID: ${idStr}`);
      process.exit(1);
    }
    numericIds.push(num);
  }

  // Connect to database
  try {
    createPool(config.db);
  } catch {
    console.error('ERROR: Cannot connect to database. Run "gd init" first.');
    process.exit(1);
  }

  // Look up files
  const files: SearchResult[] = [];
  for (const id of numericIds) {
    const file = await getFileById(id);
    if (!file) {
      console.error(`WARNING: File with ID ${id} not found in database. Skipping.`);
      continue;
    }
    files.push(file);
  }

  await closePool();

  if (files.length === 0) {
    console.error('No valid files to download.');
    process.exit(1);
  }

  console.log(`Downloading ${files.length} file(s) (max concurrency: ${config.maxConcurrency})...\n`);

  // Download with concurrency limit
  let completed = 0;
  let success = 0;
  const queue = [...files];

  async function processQueue(): Promise<void> {
    while (queue.length > 0) {
      const batch = queue.splice(0, config.maxConcurrency);
      const tasks = batch.map((file, i) =>
        downloadSingleFile(file, config, completed + i + 1, files.length)
      );
      const results = await Promise.all(tasks);
      completed += batch.length;
      success += results.filter(Boolean).length;
    }
  }

  await processQueue();

  console.log(`\nDone — ${success}/${files.length} downloaded successfully.`);
  if (success < files.length) {
    console.log(`${files.length - success} file(s) failed. Check the error messages above.`);
  }
}
