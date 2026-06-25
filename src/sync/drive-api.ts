import * as https from 'https';
import { execFileSync } from 'child_process';
import { ChangeItem } from '../types';

let cachedToken: { access_token: string; expires_at: number } | null = null;

/**
 * Get a fresh Google Drive OAuth access token by extracting credentials
 * from rclone config and exchanging the refresh token.
 */
export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expires_at - 60000) {
    return cachedToken.access_token;
  }

  // Read rclone config to extract refresh token and client credentials
  const rcloneConfig = execFileSync('rclone', ['config', 'show', 'gdrive-dtv'], {
    encoding: 'utf-8',
  });

  // Parse INI-style rclone config
  const refreshMatch = rcloneConfig.match(/token\s*=\s*(.+)/);
  if (!refreshMatch) throw new Error('Could not find token in rclone config');

  const tokenJson = JSON.parse(refreshMatch[1]);
  const refreshToken = tokenJson.refresh_token;
  if (!refreshToken) throw new Error('No refresh_token in rclone config');

  // Extract client_id and client_secret from rclone config or use defaults
  const clientIdMatch = rcloneConfig.match(/client_id\s*=\s*(.+)/);
  const clientSecretMatch = rcloneConfig.match(/client_secret\s*=\s*(.+)/);

  const clientId = clientIdMatch ? clientIdMatch[1].trim() : '';
  const clientSecret = clientSecretMatch ? clientSecretMatch[1].trim() : '';

  // Exchange refresh token for access token
  const tokenResponse = await postForm(
    'oauth2.googleapis.com',
    '/token',
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString()
  );

  const token = JSON.parse(tokenResponse);
  cachedToken = {
    access_token: token.access_token,
    expires_at: Date.now() + (token.expires_in || 3599) * 1000,
  };

  return cachedToken.access_token;
}

/**
 * Get a start page token for Google Drive changes API.
 */
export async function getStartPageToken(accessToken: string): Promise<string> {
  const data = await httpsGet(
    'www.googleapis.com',
    '/drive/v3/changes/startPageToken',
    { Authorization: `Bearer ${accessToken}` }
  );
  const json = JSON.parse(data);
  return json.startPageToken;
}

/**
 * List changes since a given page token.
 * Handles pagination automatically.
 */
export async function listChanges(
  accessToken: string,
  pageToken: string,
  onProgress?: (current: number) => void
): Promise<{ changes: ChangeItem[]; newStartPageToken: string }> {
  const allChanges: ChangeItem[] = [];
  let currentPageToken = pageToken;
  let processed = 0;

  while (currentPageToken) {
    const data = await httpsGet(
      'www.googleapis.com',
      `/drive/v3/changes?pageToken=${currentPageToken}&pageSize=1000&fields=changes(file(id,name,parents,mimeType,trashed,size,modifiedTime),fileId,type,removed),nextPageToken,newStartPageToken&includeItemsFromAllDrives=true&supportsAllDrives=true`,
      { Authorization: `Bearer ${accessToken}` }
    );

    const json = JSON.parse(data);

    if (json.changes) {
      for (const change of json.changes) {
        if (change.file && change.type === 'file') {
          allChanges.push({
            fileId: change.fileId || change.file?.id,
            name: change.file.name || '',
            mimeType: change.file.mimeType || '',
            parents: change.file.parents || [],
            trashed: change.file.trashed || false,
            removed: change.removed || false,
            size: change.file.size || undefined,
            modifiedTime: change.file.modifiedTime || undefined,
          });
        }
      }
    }

    processed += (json.changes || []).length;
    onProgress?.(processed);

    currentPageToken = json.nextPageToken || null;

    if (json.newStartPageToken) {
      return { changes: allChanges, newStartPageToken: json.newStartPageToken };
    }
  }

  // If we never got a newStartPageToken, get one fresh
  const newToken = await getStartPageToken(accessToken);
  return { changes: allChanges, newStartPageToken: newToken };
}

// --- HTTPS helpers ---

function httpsGet(hostname: string, path: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { hostname, path, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function postForm(hostname: string, path: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}
