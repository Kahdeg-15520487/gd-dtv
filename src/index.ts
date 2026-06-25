#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init';
import { importCommand } from './commands/import';
import { searchCommand, getLastSession } from './commands/search';
import { downloadCommand } from './commands/download';
import { configCommand } from './commands/config';
import { statusCommand } from './commands/status';
import { syncCommand } from './commands/sync';
import { sizeCommand } from './commands/size';
import { startWebServer } from './web/server';

const program = new Command();

program
  .name('gd')
  .description('Fuzzy search and download files from Google Drive via rclone')
  .version('1.0.0');

// gd init
program
  .command('init')
  .description('Start PostgreSQL via Docker and create the database schema')
  .action(async () => {
    try {
      await initCommand();
    } catch (err) {
      console.error('Fatal error:', err);
      process.exit(1);
    }
  });

// gd import
program
  .command('import')
  .description('Full import of drive file listing via rclone lsjson')
  .action(async () => {
    try {
      await importCommand();
    } catch (err) {
      console.error('Fatal error:', err);
      process.exit(1);
    }
  });

// gd sync
program
  .command('sync')
  .description('Incremental sync using Google Drive changes API')
  .action(async () => {
    try {
      await syncCommand();
    } catch (err) {
      console.error('Fatal error:', err);
      process.exit(1);
    }
  });

// gd search <query>
program
  .command('search')
  .description('Fuzzy search for files by name or path')
  .argument('<query>', 'Search query (filename or path fragment)')
  .action(async (query: string) => {
    try {
      await searchCommand(query);
    } catch (err) {
      console.error('Fatal error:', err);
      process.exit(1);
    }
  });

// gd download <ids...>
program
  .command('download')
  .description('Download files by database ID')
  .argument('<ids...>', 'File IDs to download (space-separated)')
  .action(async (ids: string[]) => {
    try {
      await downloadCommand(ids);
    } catch (err) {
      console.error('Fatal error:', err);
      process.exit(1);
    }
  });

// gd size
program
  .command('size')
  .description('Show total file count and total size of the drive')
  .action(() => {
    try {
      sizeCommand();
    } catch (err) {
      console.error('Fatal error:', err);
      process.exit(1);
    }
  });

// gd web
program
  .command('web')
  .description('Start the web frontend (default port 3000)')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .action(async (opts: { port: string }) => {
    try {
      await startWebServer(parseInt(opts.port, 10));
    } catch (err) {
      console.error('Fatal error:', err);
      process.exit(1);
    }
  });

// gd config <action> [key] [value]
program
  .command('config')
  .description('Show or update configuration')
  .argument('<action>', 'Action: show, set, or get')
  .argument('[key]', 'Config key to set or get')
  .argument('[value]', 'Value to set')
  .action((action: string, key?: string, value?: string) => {
    try {
      configCommand(action, key, value);
    } catch (err) {
      console.error('Fatal error:', err);
      process.exit(1);
    }
  });

// gd status
program
  .command('status')
  .description('Show configuration and database status')
  .action(async () => {
    try {
      await statusCommand();
    } catch (err) {
      console.error('Fatal error:', err);
      process.exit(1);
    }
  });

// Parse
program.parse(process.argv);

// Show help if no command given
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
