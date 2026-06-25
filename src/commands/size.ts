import { execFileSync } from 'child_process';
import { loadConfig } from '../config';

export function sizeCommand(): void {
  const config = loadConfig();

  if (!config.rootFolderId) {
    console.error('ERROR: rootFolderId not configured.');
    process.exit(1);
  }

  console.log('Calculating total drive size...\n');

  try {
    const args: string[] = [
      'size', 'gdrive-dtv:',
      '--drive-root-folder-id', config.rootFolderId,
      '--drive-resource-key', config.resourceKey,
    ];

    const stdout = execFileSync('rclone', args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    // rclone size outputs: "Total objects: 344178\nTotal size: 123.456 GiB (132562026496 Bytes)"
    console.log(stdout.trim());
  } catch (err: any) {
    if (err.stdout) console.log(err.stdout.trim());
    if (err.stderr) console.error(err.stderr);
    process.exit(1);
  }
}
