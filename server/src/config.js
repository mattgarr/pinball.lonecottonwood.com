import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../../config.json');

export const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
export const CONFIG_PATH_RESOLVED = CONFIG_PATH;
