import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { loadConfig } from '../config';
import { createPool, testConnection, closePool } from '../db/client';
import { createSchema } from '../db/schema';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const COMPOSE_PATH = path.join(PROJECT_ROOT, 'docker-compose.yml');

export async function initCommand(): Promise<void> {
  console.log('GDrive CLI — Initialization\n');

  // Step 1: Start Docker container
  console.log('Starting PostgreSQL via Docker Compose...');
  const composeFile = path.resolve(PROJECT_ROOT, 'docker-compose.yml');
  if (!fs.existsSync(composeFile)) {
    console.error('ERROR: docker-compose.yml not found at', composeFile);
    process.exit(1);
  }

  try {
    execSync(`docker compose -f "${composeFile}" up -d`, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('ERROR: Failed to start Docker containers.');
    console.error('Make sure Docker is running and try again.');
    process.exit(1);
  }
  console.log('Docker containers started.\n');

  // Step 2: Wait for PostgreSQL to be ready
  const config = loadConfig();
  console.log('Waiting for PostgreSQL to be ready...');
  let connected = false;
  for (let i = 0; i < 30; i++) {
    try {
      createPool(config.db);
      connected = await testConnection();
      if (connected) break;
    } catch {
      // not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (!connected) {
    console.error('ERROR: Could not connect to PostgreSQL after 30 seconds.');
    process.exit(1);
  }
  console.log('PostgreSQL is ready.\n');

  // Step 3: Create schema
  console.log('Creating database schema...');
  try {
    await createSchema();
  } catch (err) {
    console.error('ERROR: Failed to create schema:', err);
    await closePool();
    process.exit(1);
  }
  console.log('Schema created successfully.\n');

  // Step 4: Verify
  const fileCount = 0; // no files imported yet
  console.log('Initialization complete!');
  console.log('  Database: postgresql://gdrive:gdrive@localhost:5432/gdrive');
  console.log('  Schema:   drive_files table ready');
  console.log('');
  console.log('Next steps:');
  console.log('  gd import <path-to-drive_map.txt>   — Import file listing');
  console.log('  gd config rootFolderId <id>         — Set Google Drive root folder');
  console.log('  gd config resourceKey <key>         — Set resource key');

  await closePool();
}
