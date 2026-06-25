import { loadConfig, updateConfig, getConfigPath } from '../config';

export function configCommand(action: string, key?: string, value?: string): void {
  const config = loadConfig();

  switch (action) {
    case 'show': {
      console.log('GDrive CLI — Configuration');
      console.log(`Config file: ${getConfigPath()}\n`);
      console.log(JSON.stringify(config, null, 2));
      break;
    }

    case 'set': {
      if (!key || value === undefined) {
        console.error('Usage: gd config set <key> <value>');
        console.error('Keys: rootFolderId, resourceKey, downloadDir, maxConcurrency, lastChangeToken');
        console.error('      db.host, db.port, db.database, db.user, db.password');
        process.exit(1);
      }

      const updates: any = {};

      if (key.startsWith('db.')) {
        const dbKey = key.substring(3);
        const validDbKeys = ['host', 'port', 'database', 'user', 'password'];
        if (!validDbKeys.includes(dbKey)) {
          console.error(`Invalid database key: ${dbKey}`);
          console.error(`Valid keys: ${validDbKeys.join(', ')}`);
          process.exit(1);
        }
        const numVal = (dbKey === 'port') ? parseInt(value, 10) : value;
        updates.db = { [dbKey]: numVal };
      } else {
        const validKeys = ['rootFolderId', 'resourceKey', 'downloadDir', 'maxConcurrency', 'lastChangeToken'];
        if (!validKeys.includes(key)) {
          console.error(`Invalid key: ${key}`);
          console.error(`Valid keys: ${validKeys.join(', ')}`);
          process.exit(1);
        }
        const numVal = (key === 'maxConcurrency') ? parseInt(value, 10) : value;
        updates[key] = numVal;
      }

      updateConfig(updates);
      console.log(`Updated ${key} = ${value}`);
      break;
    }

    case 'get': {
      if (!key) {
        console.error('Usage: gd config get <key>');
        process.exit(1);
      }

      if (key.startsWith('db.')) {
        const dbKey = key.substring(3) as keyof typeof config.db;
        console.log((config.db as any)[dbKey] ?? '(not set)');
      } else {
        console.log((config as any)[key] ?? '(not set)');
      }
      break;
    }

    default:
      console.error(`Unknown config action: ${action}`);
      console.error('Usage: gd config <show|set|get> [key] [value]');
      process.exit(1);
  }
}
