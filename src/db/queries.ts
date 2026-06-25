import { QueryResult } from 'pg';
import { getPool } from './client';
import { SearchResult, DriveEntry, DriveFolder } from '../types';

export async function searchFiles(
  query: string,
  limit: number = 25,
  offset: number = 0,
  extensions?: string[],
): Promise<{ results: SearchResult[]; total: number }> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Build extension filter clause
    let extClause = '';
    const params: any[] = [query];
    if (extensions && extensions.length > 0) {
      const placeholders = extensions.map((_, i) => `$${i + 2}`);
      extClause = `AND lower(reverse(split_part(reverse(filename), '.', 1))) IN (${placeholders.join(', ')})`;
      params.push(...extensions.map(e => e.toLowerCase()));
    }

    const limitParam = `$${params.length + 1}`;
    const offsetParam = `$${params.length + 2}`;

    // Set similarity threshold for this transaction only — prevents 30K+ false positives
    await client.query('BEGIN');
    await client.query('SET LOCAL pg_trgm.similarity_threshold = 0.35');

    // Count total matches (without limit/offset)
    const countSql = `
      SELECT COUNT(*) AS total
      FROM drive_files
      WHERE is_dir = FALSE
        AND (filename % $1 OR full_path % $1)
        ${extClause}
    `;
    const countResult = await client.query(countSql, params);
    const total = parseInt(countResult.rows[0].total, 10);

    // Fetch page
    const searchSql = `
      SELECT id, filename, full_path AS "fullPath", size, mtime,
             (similarity(filename, $1) * 2 + similarity(full_path, $1)) AS score
      FROM drive_files
      WHERE is_dir = FALSE
        AND (filename % $1 OR full_path % $1)
        ${extClause}
      ORDER BY score DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;
    const result = await client.query(
      searchSql,
      [...params, limit, offset],
    );

    await client.query('COMMIT');

    const results = result.rows.map((row: any) => {
      const lastSlash = row.fullPath.lastIndexOf('/');
      const folder = lastSlash >= 0 ? row.fullPath.substring(0, lastSlash) || '/' : '/';
      const dotIdx = row.filename.lastIndexOf('.');
      const extension = dotIdx >= 0 ? row.filename.substring(dotIdx + 1).toLowerCase() : '';

      return {
        id: row.id,
        filename: row.filename,
        fullPath: row.fullPath,
        folder,
        extension,
        size: row.size ? parseInt(row.size, 10) : null,
        mtime: row.mtime ? new Date(row.mtime).toISOString() : null,
        score: parseFloat(row.score),
      };
    });

    return { results, total };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function bulkInsertFiles(entries: DriveEntry[]): Promise<number> {
  const pool = getPool();
  if (entries.length === 0) return 0;

  const values: any[] = [];
  const placeholders: string[] = [];
  let idx = 1;
  for (const entry of entries) {
    placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`);
    values.push(
      entry.fileId || null,
      entry.filename,
      entry.fullPath,
      entry.isDir,
      entry.size ?? null,
      entry.mtime ?? null,
    );
    idx += 6;
  }

  const sql = `
    INSERT INTO drive_files (file_id, filename, full_path, is_dir, size, mtime)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (file_id) DO UPDATE SET
      filename = EXCLUDED.filename,
      full_path = EXCLUDED.full_path,
      is_dir = EXCLUDED.is_dir,
      size = EXCLUDED.size,
      mtime = EXCLUDED.mtime
  `;
  const result = await pool.query(sql, values);
  return result.rowCount ?? 0;
}

export async function upsertFile(
  fileId: string,
  filename: string,
  fullPath: string,
  isDir: boolean = false,
  size?: number,
  mtime?: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO drive_files (file_id, filename, full_path, is_dir, size, mtime)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (file_id) DO UPDATE SET
       filename = EXCLUDED.filename,
       full_path = EXCLUDED.full_path,
       is_dir = EXCLUDED.is_dir,
       size = EXCLUDED.size,
       mtime = EXCLUDED.mtime`,
    [fileId, filename, fullPath, isDir, size ?? null, mtime ?? null]
  );
}

export async function deleteFileByFileId(fileId: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM drive_files WHERE file_id = $1', [fileId]);
}

export async function countFiles(): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    'SELECT COUNT(*) AS cnt FROM drive_files WHERE is_dir = FALSE'
  );
  return parseInt(result.rows[0].cnt, 10);
}

export async function countDirs(): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    'SELECT COUNT(*) AS cnt FROM drive_files WHERE is_dir = TRUE'
  );
  return parseInt(result.rows[0].cnt, 10);
}

export async function getFileById(id: number): Promise<SearchResult | null> {
  const pool = getPool();
  const result = await pool.query(
    'SELECT id, filename, full_path AS "fullPath", size, mtime FROM drive_files WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const lastSlash = row.fullPath.lastIndexOf('/');
  const folder = lastSlash >= 0 ? row.fullPath.substring(0, lastSlash) || '/' : '/';
  const dotIdx = row.filename.lastIndexOf('.');
  const extension = dotIdx >= 0 ? row.filename.substring(dotIdx + 1).toLowerCase() : '';

  return {
    id: row.id,
    filename: row.filename,
    fullPath: row.fullPath,
    folder,
    extension,
    size: row.size ? parseInt(row.size, 10) : null,
    mtime: row.mtime ? new Date(row.mtime).toISOString() : null,
    score: 0,
  };
}

/** Get full file info by ID — same as getFileById, semantic alias for the API */
export async function getFileInfo(id: number): Promise<SearchResult | null> {
  return getFileById(id);
}

/** Get all unique file extensions with counts */
export async function getFormats(): Promise<{ extension: string; count: number }[]> {
  const pool = getPool();
  const result = await pool.query(`
    SELECT lower(reverse(split_part(reverse(filename), '.', 1))) AS extension,
           COUNT(*)::int AS count
    FROM drive_files
    WHERE is_dir = FALSE
      AND filename LIKE '%.%'
    GROUP BY extension
    ORDER BY count DESC
  `);
  return result.rows;
}

// --- Folder mapping for sync ---

export async function upsertFolders(folders: DriveFolder[]): Promise<void> {
  const pool = getPool();
  if (folders.length === 0) return;

  const values: any[] = [];
  const placeholders: string[] = [];
  let idx = 1;
  for (const f of folders) {
    placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2})`);
    values.push(f.id, f.name, f.parentId);
    idx += 3;
  }

  await pool.query(
    `INSERT INTO drive_folders (id, name, parent_id)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (id) DO NOTHING`,
    values
  );
}

export async function getFolderById(id: string): Promise<DriveFolder | null> {
  const pool = getPool();
  const result = await pool.query(
    'SELECT id, name, parent_id AS "parentId" FROM drive_folders WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

/**
 * Resolve a full path from folder IDs by walking up the drive_folders table.
 * Returns path like "/folder/subfolder"
 */
export async function resolveFolderPath(folderId: string): Promise<string> {
  const pool = getPool();
  const parts: string[] = [];
  let currentId: string | null = folderId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const result: QueryResult<{ name: string; parentId: string | null }> = await pool.query(
      'SELECT name, parent_id AS "parentId" FROM drive_folders WHERE id = $1',
      [currentId]
    );
    if (result.rows.length === 0) break;
    parts.unshift(result.rows[0].name);
    currentId = result.rows[0].parentId;
  }

  return '/' + parts.join('/');
}
