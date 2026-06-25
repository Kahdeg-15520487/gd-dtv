import express from 'express';
import * as path from 'path';
import { loadConfig } from '../config';
import { createPool, testConnection } from '../db/client';
import { searchFiles, getFileById, getFileInfo, getFormats, countFiles } from '../db/queries';

const app = express();
app.set('trust proxy', true);  // Trust Traefik X-Forwarded-Proto for HTTPS URLs
app.use(express.json());

const PUBLIC_DIR = path.join(__dirname, 'public');

// Load config and connect DB at startup
const config = loadConfig();

// Allow env vars to override DB connection (for Docker)
if (process.env.DB_HOST) config.db.host = process.env.DB_HOST;
if (process.env.DB_PORT) config.db.port = parseInt(process.env.DB_PORT, 10);
if (process.env.DB_NAME) config.db.database = process.env.DB_NAME;
if (process.env.DB_USER) config.db.user = process.env.DB_USER;
if (process.env.DB_PASSWORD) config.db.password = process.env.DB_PASSWORD;

// --- API routes ---

// Search — enriched with extension/size/mtime/folder, supports format filter + pagination
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q as string) || '';
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const ext = (req.query.ext as string) || undefined;
    const extensions = ext ? ext.split(',').map(e => e.trim().toLowerCase()).filter(Boolean) : undefined;

    if (!q.trim()) {
      return res.json({ results: [], total: 0, query: '', limit, offset });
    }

    const { results, total } = await searchFiles(q.trim(), limit, offset, extensions);
    res.json({ results, total, query: q.trim(), limit, offset });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single file info by ID
app.get('/api/file/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    const file = await getFileInfo(id);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json(file);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all file formats with counts
app.get('/api/formats', async (_req, res) => {
  try {
    const formats = await getFormats();
    res.json({ formats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Download single file — caches to temp volume, serves from cache if present
app.get('/api/download', async (req, res) => {
  console.log('[DOWNLOAD] route hit, query:', req.query, 'url:', req.url);
  try {
    const id = parseInt(req.query.id as string);
    if (isNaN(id)) {
      console.log('[DOWNLOAD] invalid id:', req.query.id);
      return res.status(400).json({ error: 'Invalid ID' });
    }

    console.log('[DOWNLOAD] looking up id:', id);
    const file = await getFileById(id);
    if (!file) {
      console.log('[DOWNLOAD] file not found for id:', id);
      return res.status(404).json({ error: 'File not found' });
    }
    console.log('[DOWNLOAD] found file:', file.filename, 'path:', file.fullPath);

    const fs = await import('fs');
    const tmpDir = '/tmp/gdrive';
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, `${id}_${file.filename}`);
    console.log('[DOWNLOAD] tmpPath:', tmpPath);

    if (!fs.existsSync(tmpPath)) {
      const remotePath = `gdrive-dtv:${file.fullPath}`;
      const args = ['copyto', remotePath, tmpPath, '--ignore-existing'];
      if (config.rootFolderId) args.push('--drive-root-folder-id', config.rootFolderId);
      if (config.resourceKey) args.push('--drive-resource-key', config.resourceKey);
      console.log('[DOWNLOAD] rclone args:', args.join(' '));

      const cp = await import('child_process');
      await new Promise<void>((resolve, reject) => {
        console.log('[DOWNLOAD] spawning rclone...');
        const proc = cp.execFile('rclone', args, (err, stdout, stderr) => {
          if (stdout) console.log('[DOWNLOAD] rclone stdout:', stdout);
          if (stderr) console.log('[DOWNLOAD] rclone stderr:', stderr);
          if (err) {
            console.log('[DOWNLOAD] rclone FAILED:', err.message);
            try { fs.rmSync(tmpPath, { recursive: true, force: true }); } catch {}
            reject(err);
          } else {
            // Verify it's a regular file, not a directory
            try {
              const s = fs.statSync(tmpPath);
              if (s.isDirectory()) {
                fs.rmSync(tmpPath, { recursive: true, force: true });
                reject(new Error('rclone created directory instead of file'));
                return;
              }
              console.log('[DOWNLOAD] rclone OK, size:', s.size);
              resolve();
            } catch (statErr: any) {
              reject(new Error('Downloaded file not found: ' + statErr.message));
            }
          }
        });
      });
    } else {
      const stat = fs.statSync(tmpPath);
      if (stat.isDirectory()) {
        console.log('[DOWNLOAD] stale dir detected, removing:', tmpPath);
        fs.rmSync(tmpPath, { recursive: true });
        throw new Error('Cached entry was a directory — retry download');
      }
      console.log('[DOWNLOAD] serving from cache, size:', stat.size);
    }

    const encodedName = encodeURIComponent(file.filename);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    console.log('[DOWNLOAD] sending file...');
    res.sendFile(tmpPath, (err) => {
      if (err) console.log('[DOWNLOAD] sendFile error:', err.message);
    });
  } catch (err: any) {
    console.log('[DOWNLOAD] ERROR:', err.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Download failed' });
    }
  }
});

// Status
app.get('/api/status', async (_req, res) => {
  try {
    const connected = await testConnection();
    const total = connected ? await countFiles() : 0;
    res.json({ connected, totalFiles: total });
  } catch {
    res.json({ connected: false, totalFiles: 0 });
  }
});

// --- OPDS endpoints ---

const MIME_MAP: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  mobi: 'application/x-mobipocket-ebook',
  azw: 'application/x-mobipocket-ebook',
  azw3: 'application/x-mobipocket-ebook',
  cbz: 'application/vnd.comicbook+zip',
  cbr: 'application/vnd.comicbook-rar',
  fb2: 'application/x-fictionbook+xml',
  txt: 'text/plain',
  prc: 'application/x-mobipocket-ebook',
};

function extensionToMime(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? 'application/octet-stream';
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// OPDS catalog root — minimal feed with search link
app.get('/opds', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const updated = new Date().toISOString();
  res.type('application/atom+xml; charset=utf-8').send(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<feed xmlns="http://www.w3.org/2005/Atom" ' +
    'xmlns:opds="http://opds-spec.org/2010/catalog">' +
    `<id>gdrive:catalog</id>` +
    '<title>GDrive Archive</title>' +
    `<updated>${updated}</updated>` +
    `<author><name>GDrive Catalog</name></author>` +
    `<link rel="self" href="${escXml(baseUrl)}/opds" type="application/atom+xml"/>` +
    `<link rel="search" href="${escXml(baseUrl)}/opds/search-description.xml" type="application/opensearchdescription+xml"/>` +
    '</feed>'
  );
});

// OpenSearch description
app.get('/opds/search-description.xml', (_req, res) => {
  const baseUrl = `${_req.protocol}://${_req.get('host')}`;
  res.type('application/opensearchdescription+xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>GDrive Search</ShortName>
  <Description>Search Google Drive book archive</Description>
  <Url type="application/atom+xml"
       template="${escXml(baseUrl)}/opds/search?q={searchTerms}&amp;limit={count}&amp;offset={startIndex}"/>
</OpenSearchDescription>`);
});

// OPDS search — returns Atom feed
app.get('/opds/search', async (req, res) => {
  try {
    const q = (req.query.q as string) || '';
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    if (!q.trim()) {
      return res.type('application/atom+xml; charset=utf-8').send(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<feed xmlns="http://www.w3.org/2005/Atom" ' +
        'xmlns:opds="http://opds-spec.org/2010/catalog" ' +
        'xmlns:dcterms="http://purl.org/dc/terms/">' +
        '<id>gdrive:search:empty</id><title>Search</title><updated>' + new Date().toISOString() + '</updated></feed>'
      );
    }

    const { results, total } = await searchFiles(q.trim(), limit, offset);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const updated = new Date().toISOString();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>';
    xml += '<feed xmlns="http://www.w3.org/2005/Atom" ';
    xml += 'xmlns:opds="http://opds-spec.org/2010/catalog" ';
    xml += 'xmlns:dcterms="http://purl.org/dc/terms/">';
    xml += `<id>gdrive:search:${escXml(q)}</id>`;
    xml += `<title>Search: ${escXml(q)}</title>`;
    xml += `<updated>${updated}</updated>`;
    xml += `<author><name>GDrive Catalog</name></author>`;
    xml += `<link rel="self" href="${escXml(baseUrl)}/opds/search?q=${encodeURIComponent(q)}&amp;limit=${limit}&amp;offset=${offset}" type="application/atom+xml"/>`;
    xml += `<link rel="search" href="${escXml(baseUrl)}/opds/search-description.xml" type="application/opensearchdescription+xml"/>`;
    xml += `<opds:totalResults>${total}</opds:totalResults>`;
    xml += `<opds:itemsPerPage>${limit}</opds:itemsPerPage>`;

    if (offset > 0) {
      const prevOff = Math.max(0, offset - limit);
      xml += `<link rel="prev" href="${escXml(baseUrl)}/opds/search?q=${encodeURIComponent(q)}&amp;limit=${limit}&amp;offset=${prevOff}" type="application/atom+xml"/>`;
    }
    if (offset + results.length < total) {
      const nextOff = offset + limit;
      xml += `<link rel="next" href="${escXml(baseUrl)}/opds/search?q=${encodeURIComponent(q)}&amp;limit=${limit}&amp;offset=${nextOff}" type="application/atom+xml"/>`;
    }

    for (const r of results) {
      const mime = extensionToMime(r.extension);
      const dlUrl = `${escXml(baseUrl)}/api/download?id=${r.id}`;
      xml += '<entry>';
      xml += `<title>${escXml(r.filename)}</title>`;
      xml += `<id>gdrive:${r.id}</id>`;
      xml += `<updated>${r.mtime ?? updated}</updated>`;
      xml += `<dcterms:extent>${r.size ?? 0}</dcterms:extent>`;
      xml += `<link rel="http://opds-spec.org/acquisition" href="${dlUrl}" type="${escXml(mime)}"/>`;
      xml += `<link rel="http://opds-spec.org/image/thumbnail" href="${dlUrl}" type="${escXml(mime)}"/>`;
      xml += '</entry>';
    }

    xml += '</feed>';
    res.type('application/atom+xml; charset=utf-8').send(xml);
  } catch (err: any) {
    res.status(500).type('application/atom+xml; charset=utf-8').send(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<feed xmlns="http://www.w3.org/2005/Atom">' +
      '<id>gdrive:error</id><title>Error</title>' +
      `<updated>${new Date().toISOString()}</updated>` +
      `<entry><title>${escXml(err.message)}</title></entry></feed>`
    );
  }
});

// Serve static frontend
app.use(express.static(PUBLIC_DIR));

// Start server
export async function startWebServer(port: number = 3000): Promise<void> {
  // Initialize DB connection
  createPool(config.db);

  const connected = await testConnection();
  if (!connected) {
    console.error('WARNING: Cannot connect to database. Run "gd init" first.');
    console.error('Web server will start but search will not work.\n');
  } else {
    const total = await countFiles();
    console.log(`Database connected. ${total.toLocaleString()} files indexed.\n`);
  }

  app.listen(port, () => {
    console.log(`GDrive Web UI running at http://localhost:${port}`);
  });
}

// Allow running directly
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3000', 10);
  startWebServer(port).catch((err) => {
    console.error('Failed to start web server:', err);
    process.exit(1);
  });
}
