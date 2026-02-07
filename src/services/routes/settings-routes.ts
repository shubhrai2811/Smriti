import { Hono } from 'hono';
import { getConfig } from '../../shared/config.js';
import type { SmritiSettings } from '../../shared/config.js';

export function settingsRoutes(): Hono {
  const app = new Hono();

  // GET /settings — return all current settings
  app.get('/', (c) => {
    const config = getConfig();
    return c.json(config.getAll());
  });

  // PUT /settings — update settings by section.key
  // Body: { "worker": { "port": 8080 }, "context": { "tokenBudget": 6000 } }
  app.put('/', async (c) => {
    const body = await c.req.json() as Partial<SmritiSettings>;
    const config = getConfig();
    const allSettings = config.getAll() as Record<string, Record<string, unknown>>;

    // Iterate over top-level sections and their keys
    for (const [section, sectionValue] of Object.entries(body)) {
      if (typeof sectionValue === 'object' && sectionValue !== null && section in allSettings) {
        for (const [key, value] of Object.entries(sectionValue)) {
          (allSettings[section] as Record<string, unknown>)[key] = value;
        }
      }
    }

    config.save();
    return c.json({ updated: true });
  });

  return app;
}
