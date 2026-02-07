import { join } from 'path';
import { homedir } from 'os';

export const SMRITI_DIR = join(homedir(), '.smriti');
export const DB_PATH = join(SMRITI_DIR, 'smriti.sqlite');
export const SETTINGS_PATH = join(SMRITI_DIR, 'settings.json');
export const PID_FILE_PATH = join(SMRITI_DIR, 'worker.pid');
export const LOG_DIR = join(SMRITI_DIR, 'logs');
export const ENV_PATH = join(SMRITI_DIR, '.env');
export const OBSERVER_SESSIONS_DIR = join(SMRITI_DIR, 'observer-sessions');
export const MODELS_DIR = join(SMRITI_DIR, 'models');
