import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hubRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Parse a dotenv file. Later files can override these values; existing process env wins. */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match?.[1]) continue;
    let value = match[2] ?? '';
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"');
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

/**
 * Load the same local files Next.js reads for Hub, without overriding variables
 * already present in the process (production hosts inject those).
 */
export function loadHubEnv(root = hubRoot, mode = process.env.NODE_ENV || 'development'): void {
  const preexisting = new Set(Object.keys(process.env));
  const files = ['.env', `.env.${mode}`];
  if (mode !== 'test') files.push('.env.local');
  files.push(`.env.${mode}.local`);
  const merged: Record<string, string> = {};
  for (const name of files) {
    try {
      Object.assign(merged, parseEnv(readFileSync(path.join(root, name), 'utf8')));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  for (const [key, value] of Object.entries(merged)) {
    if (!preexisting.has(key)) process.env[key] = value;
  }
}
