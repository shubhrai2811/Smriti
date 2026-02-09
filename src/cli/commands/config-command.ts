import { getConfig, resetConfig } from '../../shared/config.js';

export async function configCommand(args: string[]): Promise<void> {
  const subCmd = args[0];

  switch (subCmd) {
    case 'get': {
      const key = args[1];
      if (!key) {
        console.error('Usage: smriti config get <section.key>');
        process.exit(1);
      }
      const config = getConfig();
      const parts = key.split('.');
      if (parts.length === 1) {
        const section = config.get(parts[0] as any);
        console.log(JSON.stringify(section, null, 2));
      } else {
        const value = config.get(parts[0] as any, parts[1] as any);
        console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
      }
      break;
    }

    case 'set': {
      const key = args[1];
      const rawValue = args.slice(2).join(' ');
      if (!key || rawValue === '') {
        console.error('Usage: smriti config set <section.key> <value>');
        process.exit(1);
      }
      const parts = key.split('.');
      if (parts.length !== 2) {
        console.error('Key must be in format: section.key (e.g., context.tokenBudget)');
        process.exit(1);
      }
      const config = getConfig();
      // Parse value: try number, then boolean, then string
      let value: any = rawValue;
      if (rawValue === 'true') value = true;
      else if (rawValue === 'false') value = false;
      else if (!Number.isNaN(Number(rawValue)) && rawValue.trim() !== '') value = Number(rawValue);

      config.set(parts[0] as any, parts[1] as any, value);
      config.save();
      console.log(`Set ${key} = ${JSON.stringify(value)}`);
      break;
    }

    case 'reset': {
      resetConfig();
      const config = getConfig();
      config.save();
      console.log('Settings reset to defaults');
      break;
    }

    default: {
      // No subcommand = show all settings
      const config = getConfig();
      const all = config.getAll();
      console.log(JSON.stringify(all, null, 2));
      break;
    }
  }
}
