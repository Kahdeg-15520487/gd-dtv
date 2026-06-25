import { loadConfig } from '../config';
import { createPool, testConnection, closePool } from '../db/client';
import { countFiles, countDirs } from '../db/queries';

export async function statusCommand(): Promise<void> {
  console.log('GDrive CLI — Status\n');

  // Config
  const config = loadConfig();
  console.log('Configuration:');
  console.log(`  Config file:    ~/.gdrive-cli/config.json`);
  console.log(`  Root folder ID: ${config.rootFolderId || '(not set)'}`);
  console.log(`  Resource key:   ${config.resourceKey ? '✓ set' : '(not set)'}`);
  console.log(`  Download dir:   ${config.downloadDir}`);
  console.log(`  Max concurrency: ${config.maxConcurrency}`);
  console.log(`  DB:             postgresql://${config.db.user}:****@${config.db.host}:${config.db.port}/${config.db.database}`);
  console.log();

  // Database
  console.log('Database:');
  try {
    createPool(config.db);
  } catch (err) {
    console.log('  Status:  ❌ Could not create connection pool');
    return;
  }

  const connected = await testConnection();
  if (!connected) {
    console.log('  Status:  ❌ Not connected');
    console.log('  Run "gd init" to start the database.');
    await closePool();
    return;
  }

  console.log('  Status:  ✓ Connected');

  try {
    const files = await countFiles();
    const dirs = await countDirs();
    console.log(`  Files:       ${files.toLocaleString()}`);
    console.log(`  Directories: ${dirs.toLocaleString()}`);
  } catch {
    console.log('  Schema:  ❌ Not initialized (run "gd init")');
  }

  await closePool();
}
