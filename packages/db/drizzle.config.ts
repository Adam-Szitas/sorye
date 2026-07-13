import { defineConfig } from 'drizzle-kit';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://sorye:sorye@localhost:5432/sorye';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
});
