import { readJsonFromStdin } from './stdin-reader.js';
import { getAdapter, detectPlatform } from './adapters/index.js';
import { getHandler } from './handlers/index.js';
import { HOOK_EXIT_CODES } from '../shared/constants.js';
import { logger } from '../utils/logger.js';

export async function hookCommand(
  platform: string,
  event: string,
): Promise<number> {
  try {
    const handler = getHandler(event);
    const rawInput = await readJsonFromStdin();

    // Resolve platform before fetching the adapter so 'auto' works
    const resolvedPlatform = platform === 'auto'
      ? detectPlatform(rawInput)
      : platform;

    const adapter = getAdapter(resolvedPlatform);
    const input = adapter.normalizeInput(rawInput);
    input.platform = resolvedPlatform;

    const result = await handler.execute(input);
    const output = adapter.formatOutput(result);

    // Write output to stdout for the IDE to consume
    console.log(JSON.stringify(output));

    return result.exitCode ?? HOOK_EXIT_CODES.SUCCESS;
  } catch (error) {
    logger.error('HOOK', `Hook ${platform}/${event} failed`, { error: (error as Error).message });
    console.error(JSON.stringify({ error: (error as Error).message }));
    return HOOK_EXIT_CODES.BLOCKING_ERROR;
  }
}
