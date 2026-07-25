import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/database/schema/index.ts',
  out: './server/database/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://saru:saru@localhost:5432/saru',
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
})
