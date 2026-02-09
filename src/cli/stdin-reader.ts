import { HOOK_TIMEOUTS } from '../shared/constants.js';

export async function readJsonFromStdin(): Promise<unknown> {
  // Check if stdin is available and has data
  if (process.stdin.isTTY) {
    return {};
  }

  return new Promise((resolve, _reject) => {
    let buffer = '';
    let resolved = false;
    let parseTimer: ReturnType<typeof setTimeout> | null = null;

    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Try to parse what we have
        const result = tryParseJson(buffer);
        resolve(result.success ? result.value : {});
      }
    }, HOOK_TIMEOUTS.STDIN_SAFETY);

    function tryResolve() {
      if (resolved) return;
      const result = tryParseJson(buffer);
      if (result.success) {
        resolved = true;
        clearTimeout(safetyTimeout);
        if (parseTimer) clearTimeout(parseTimer);
        resolve(result.value);
      }
    }

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;
      // Try to parse immediately
      tryResolve();
      // If not parsed, set a short delay for multi-chunk delivery
      if (!resolved) {
        if (parseTimer) clearTimeout(parseTimer);
        parseTimer = setTimeout(tryResolve, HOOK_TIMEOUTS.STDIN_PARSE_DELAY);
      }
    });

    process.stdin.on('end', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(safetyTimeout);
        if (parseTimer) clearTimeout(parseTimer);
        const result = tryParseJson(buffer);
        resolve(result.success ? result.value : {});
      }
    });

    process.stdin.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(safetyTimeout);
        resolve({});
      }
    });

    // Resume stdin in case it's paused
    process.stdin.resume();
  });
}

function tryParseJson(input: string): { success: boolean; value?: unknown } {
  const trimmed = input.trim();
  if (!trimmed) return { success: false };
  try {
    return { success: true, value: JSON.parse(trimmed) };
  } catch {
    return { success: false };
  }
}
