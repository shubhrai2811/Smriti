import type { EventHandler } from '../types.js';
import { contextHandler } from './context.js';
import { sessionInitHandler } from './session-init.js';
import { observationHandler } from './observation.js';
import { summarizeHandler } from './summarize.js';
import { sessionCompleteHandler } from './session-complete.js';

const handlers: Record<string, EventHandler> = {
  'context': contextHandler,
  'session-init': sessionInitHandler,
  'observation': observationHandler,
  'summarize': summarizeHandler,
  'session-complete': sessionCompleteHandler,
};

export function getHandler(event: string): EventHandler {
  const handler = handlers[event];
  if (!handler) {
    throw new Error(`Unknown event: ${event}. Supported: ${Object.keys(handlers).join(', ')}`);
  }
  return handler;
}
