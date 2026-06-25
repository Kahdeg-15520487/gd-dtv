import { loadConfig, updateConfig } from '../config';
import { createPool, closePool } from '../db/client';
import { upsertFile, deleteFileByFileId, upsertFolders, resolveFolderPath, countFiles, countDirs } from '../db/queries';
import { getAccessToken, listChanges } from '../sync/drive-api';
import { ChangeItem, DriveFolder } from '../types';

export async function syncCommand(): Promise<void> {
  const config = loadConfig();

  if (!config.rootFolderId) {
    console.error('ERROR: rootFolderId not configured.');
    console.error('Run: gd config set rootFolderId "<id>"');
    process.exit(1);
  }

  console.log('GDrive CLI — Sync\n');

  // Get access token
  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err: any) {
    console.error(`ERROR: Failed to get Google Drive access token: ${err.message}`);
    console.error('Make sure rclone is configured with gdrive-dtv remote.');
    process.exit(1);
  }

  // Connect to database
  createPool(config.db);

  // Check if we have a change token
  if (!config.lastChangeToken) {
    console.log('No change token found. Running full import first...');
    const { importCommand } = await import('./import');
    await importCommand();
    return;
  }

  console.log(`Change token: ${config.lastChangeToken}`);
  console.log('Fetching changes from Google Drive...');

  // Fetch changes
  let changes: ChangeItem[];
  let newToken: string;
  try {
    const result = await listChanges(accessToken, config.lastChangeToken, (count) => {
      process.stdout.write(`\r  Fetched ${count} change(s)...`);
    });
    changes = result.changes;
    newToken = result.newStartPageToken;
    console.log(`\r  Fetched ${changes.length} change(s).`);
  } catch (err: any) {
    console.error(`\nERROR: Failed to fetch changes: ${err.message}`);
    await closePool();
    process.exit(1);
  }

  if (changes.length === 0) {
    console.log('\nNo changes detected. Drive is up to date.');
    // Still update the token
    updateConfig({ lastChangeToken: newToken });
    await closePool();
    return;
  }

  console.log(`\nProcessing ${changes.length} change(s)...`);

  let added = 0;
  let updated = 0;
  let deleted = 0;
  let folderUpdates = 0;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const pct = Math.round(((i + 1) / changes.length) * 100);

    if (change.removed || change.trashed) {
      // File was deleted or trashed
      await deleteFileByFileId(change.fileId);
      deleted++;
    } else if (change.mimeType === 'application/vnd.google-apps.folder') {
      // It's a folder — store in drive_folders for path resolution
      await upsertFolders([{ id: change.fileId, name: change.name, parentId: change.parents[0] || null }]);
      folderUpdates++;
    } else {
      // It's a file — resolve path from parent folder IDs
      let fullPath: string;
      try {
        if (change.parents.length > 0) {
          fullPath = await resolveFolderPath(change.parents[0]) + '/' + change.name;
        } else {
          fullPath = '/' + change.name;
        }
      } catch {
        fullPath = '/' + change.name;
      }

      const fileSize = change.size ? parseInt(change.size, 10) : undefined;
      const fileMtime = change.modifiedTime || undefined;
      await upsertFile(change.fileId, change.name, fullPath, false, fileSize, fileMtime);
      added++;
      updated++;
    }

    if (i % 50 === 0 || i === changes.length - 1) {
      process.stdout.write(`\r  Progress: ${pct}% (${i + 1}/${changes.length})...`);
    }
  }

  // Save new token
  updateConfig({ lastChangeToken: newToken });
  console.log(`\n  Change token updated: ${newToken}`);

  // Summary
  const totalFiles = await countFiles();
  const totalDirs = await countDirs();

  console.log('\nSync complete!');
  console.log(`  Added/Updated: ${added} file(s)`);
  console.log(`  Deleted:       ${deleted} file(s)`);
  console.log(`  Folders:       ${folderUpdates} updated`);
  console.log(`  Total files:   ${totalFiles.toLocaleString()}`);
  console.log(`  Total dirs:    ${totalDirs.toLocaleString()}`);

  await closePool();
}
