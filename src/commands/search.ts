import * as readline from 'readline';
import { loadConfig } from '../config';
import { createPool, closePool } from '../db/client';
import { searchFiles, getFileById } from '../db/queries';
import { SearchResult, SearchSession } from '../types';

// Store last search results for download command
let lastSession: SearchSession | null = null;

export function getLastSession(): SearchSession | null {
  return lastSession;
}

function parseSelection(input: string, maxIndex: number): number[] {
  const selected: Set<number> = new Set();
  const parts = input.split(',').map(s => s.trim()).filter(s => s.length > 0);

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-', 2);
      const start = parseInt(startStr.trim(), 10);
      const end = parseInt(endStr.trim(), 10);
      if (isNaN(start) || isNaN(end) || start < 1 || end > maxIndex || start > end) {
        console.error(`Invalid range: ${part}`);
        return [];
      }
      for (let i = start; i <= end; i++) selected.add(i);
    } else {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 1 || num > maxIndex) {
        console.error(`Invalid index: ${part}`);
        return [];
      }
      selected.add(num);
    }
  }

  return Array.from(selected).sort((a, b) => a - b);
}

function displayResults(results: SearchResult[]): void {
  if (results.length === 0) {
    console.log('\nNo files found matching your query.\n');
    return;
  }

  console.log(`\nFound ${results.length} match${results.length === 1 ? '' : 'es'}:`);

  // Calculate column widths
  const maxIdxWidth = Math.max(results.length.toString().length, 2);
  const maxNameWidth = Math.min(
    Math.max(...results.map(r => r.filename.length)),
    60
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const num = (i + 1).toString().padStart(maxIdxWidth);
    const name = r.filename.length > maxNameWidth
      ? r.filename.substring(0, maxNameWidth - 3) + '...'
      : r.filename.padEnd(maxNameWidth);

    // Show folder path truncated
    const folder = r.fullPath.substring(0, r.fullPath.lastIndexOf('/') + 1) || '/';
    const folderDisplay = folder.length > 50 ? '...' + folder.slice(-47) : folder;

    console.log(`  ${num}. ${name}  ${folderDisplay}`);
  }
  console.log();
}

async function promptSelection(maxIndex: number): Promise<number[]> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      'Type numbers to select for download (e.g. 1,3,5-8) or press Enter to skip: ',
      (answer: string) => {
        rl.close();
        if (!answer.trim()) {
          resolve([]);
          return;
        }
        const selected = parseSelection(answer.trim(), maxIndex);
        resolve(selected);
      }
    );
  });
}

export async function searchCommand(query: string): Promise<SearchResult[]> {
  if (!query || query.trim().length === 0) {
    console.error('ERROR: Please provide a search query.');
    console.error('Usage: gd search <query>');
    process.exit(1);
  }

  const config = loadConfig();

  // Connect to database
  try {
    createPool(config.db);
  } catch (err) {
    console.error('ERROR: Cannot connect to database. Run "gd init" first.');
    process.exit(1);
  }

  // Search
  console.log(`Searching for: "${query}"...`);
  let results: SearchResult[];
  try {
    const searchResult = await searchFiles(query, 20);
    results = searchResult.results;
  } catch (err) {
    console.error('ERROR: Search failed. Is the database running? Run "gd status" to check.');
    await closePool();
    process.exit(1);
  }

  // Display results
  displayResults(results);

  if (results.length === 0) {
    await closePool();
    return [];
  }

  // Store session for download command
  lastSession = {
    query,
    results,
    timestamp: Date.now(),
  };

  // Prompt for selection
  const selected = await promptSelection(results.length);

  await closePool();

  if (selected.length > 0) {
    // Return selected results for chaining to download
    const selectedResults = selected.map(i => results[i - 1]);
    console.log(`\nSelected ${selectedResults.length} file(s).`);
    console.log('Run: gd download <ids>');
    console.log('IDs: ' + selectedResults.map(r => r.id).join(', '));
    return selectedResults;
  }

  return [];
}
