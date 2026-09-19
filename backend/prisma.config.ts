import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Client generation does not need a database. Migration commands require a URL.
  datasource: { url: process.env.DATABASE_URL },
});
