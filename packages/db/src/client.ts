import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDb() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add it to apps/hub/.env.local or fly secrets.',
    );
  }

  if (!db) {
    client = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: url.includes('sslmode=require') ? 'require' : undefined,
    });
    db = drizzle(client, { schema });
  }

  return db;
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}

export { schema };
