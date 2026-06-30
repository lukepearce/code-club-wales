import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` reads the schema and writes SQL migrations to ./drizzle.
// `drizzle-kit push` / `migrate` additionally need DATABASE_URL.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
