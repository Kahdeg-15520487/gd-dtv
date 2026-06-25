import * as fs from 'fs';
import * as readline from 'readline';
import { DriveEntry } from '../types';

/**
 * Parse one line of rclone tree output.
 * Returns [depth, name, isLastChild] or null if the line is not a tree entry.
 * 
 * Example lines:
 *   /                          → root
 *   ├── folder1                → depth 0, name "folder1"
 *   │   ├── file.epub          → depth 1, name "file.epub"
 *   │   └── last.epub          → depth 1, name "last.epub" (last child)
 *   └── folder2                → depth 0, name "folder2" (last child)
 */
export function parseTreeLine(line: string): { depth: number; name: string; isLastChild: boolean } | null {
  if (!line || line === '/') return null;

  let depth = 0;
  let pos = 0;

  // Count depth by scanning 4-char blocks
  while (pos < line.length) {
    const block = line.substring(pos, pos + 4);
    if (block === '│   ' || block === '    ') {
      depth++;
      pos += 4;
    } else {
      break;
    }
  }

  // After indentation, expect ├── or └──
  const remaining = line.substring(pos);
  if (remaining.startsWith('├── ')) {
    const name = remaining.substring(4);
    // Some lines may have trailing spaces (tree often pads to terminal width)
    return { depth, name: name.replace(/\s+$/, ''), isLastChild: false };
  } else if (remaining.startsWith('└── ')) {
    const name = remaining.substring(4);
    return { depth, name: name.replace(/\s+$/, ''), isLastChild: true };
  }

  return null;
}

/**
 * Determine if a name represents a directory or file.
 * Directories typically have no file extension.
 * Files have a period separating name and extension (e.g., .epub, .txt, .pdf).
 */
function isDirectory(name: string): boolean {
  // Files always have a dot extension like .epub, .pdf, .txt, .mp4
  // Directories never have an extension (no dot, or dot in ambiguous names)
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return true;
  const ext = name.substring(lastDot + 1).toLowerCase();
  // Common file extensions in the dataset
  const fileExts = new Set([
    'epub', 'txt', 'pdf', 'mp4', 'mkv', 'avi', 'mp3', 'flac',
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'zip', 'rar', '7z',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'mobi', 'azw3',
    'cbz', 'cbr', 'html', 'css', 'js', 'ts', 'json', 'xml',
  ]);
  return !fileExts.has(ext);
}

/**
 * Build full path from path stack.
 */
function buildFullPath(stack: string[], name: string): string {
  return '/' + [...stack, name].join('/');
}

/**
 * Parse an entire rclone tree file into DriveEntry array.
 */
export async function parseTreeFile(filePath: string): Promise<DriveEntry[]> {
  const entries: DriveEntry[] = [];
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  // Stack tracks directory names at each depth level
  const dirStack: string[] = [];

  // Track last-child flags per depth to know when to pop
  const lastChildAtDepth: Map<number, boolean> = new Map();

  for await (const line of rl) {
    const parsed = parseTreeLine(line);
    if (!parsed) continue;

    const { depth, name, isLastChild } = parsed;
    const dir = isDirectory(name);

    // Pop directories from stack when we go back up
    // If the line is at depth D, dirStack should have D entries
    while (dirStack.length > depth) {
      dirStack.pop();
    }

    const fullPath = buildFullPath(dirStack, name);

    entries.push({ filename: name, fullPath, isDir: dir });

    if (dir) {
      // Push directory onto stack for children
      dirStack.push(name);
    }

    // When we encounter a last child, mark that this depth's parent
    // will be popped when we see a line at a lower depth
    if (isLastChild) {
      // The directory at dirStack[depth - 1] (the parent) just finished its last child,
      // but we don't pop yet — that happens when we see a line at shallower depth
    }
  }

  return entries;
}

/**
 * Parse a tree file synchronously (for CLI use, with progress).
 */
export function parseTreeFileSync(filePath: string): DriveEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const entries: DriveEntry[] = [];
  const dirStack: string[] = [];

  for (const line of lines) {
    const parsed = parseTreeLine(line);
    if (!parsed) continue;

    const { depth, name } = parsed;
    const dir = isDirectory(name);

    while (dirStack.length > depth) {
      dirStack.pop();
    }

    const fullPath = buildFullPath(dirStack, name);
    entries.push({ filename: name, fullPath, isDir: dir });

    if (dir) {
      dirStack.push(name);
    }
  }

  return entries;
}
