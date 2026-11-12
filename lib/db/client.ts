import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { schema } from "../../db/schema";

export type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DatabaseConnection = {
  db: AppDatabase;
  close: () => Promise<void>;
};

export type DatabaseOptions = {
  databaseUrl?: string;
  dataDir?: string;
  nodeEnv?: string;
};

const migrationsFolder = resolve(process.cwd(), "drizzle");

export async function createDatabase(options: DatabaseOptions = {}): Promise<DatabaseConnection> {
  if (options.databaseUrl) {
    const client = postgres(options.databaseUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    const db = drizzlePostgres(client, { schema });
    try {
      await migratePostgres(db, { migrationsFolder });
    } catch (error) {
      await client.end({ timeout: 1 });
      throw error;
    }
    return { db: db as AppDatabase, close: () => client.end({ timeout: 1 }) };
  }

  if (options.nodeEnv === "production") {
    throw new Error("DATABASE_URL is required in production.");
  }

  const dataDir = resolve(/* turbopackIgnore: true */ options.dataDir ?? ".local/optra-db");
  await mkdir(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite({ client, schema });
  try {
    await migratePglite(db, { migrationsFolder });
  } catch (error) {
    await client.close();
    throw error;
  }
  return { db: db as AppDatabase, close: () => client.close() };
}

type DatabaseGlobal = typeof globalThis & {
  __optraDatabaseConnection?: Promise<DatabaseConnection>;
};

const databaseGlobal = globalThis as DatabaseGlobal;

async function connection(): Promise<DatabaseConnection> {
  databaseGlobal.__optraDatabaseConnection ??= createDatabase({
    databaseUrl: process.env.DATABASE_URL,
    dataDir: process.env.PGLITE_DATA_DIR,
    nodeEnv: process.env.NODE_ENV,
  });

  try {
    return await databaseGlobal.__optraDatabaseConnection;
  } catch (error) {
    databaseGlobal.__optraDatabaseConnection = undefined;
    throw error;
  }
}

export async function getDatabase(): Promise<AppDatabase> {
  return (await connection()).db;
}

export async function closeDatabase(): Promise<void> {
  const active = databaseGlobal.__optraDatabaseConnection;
  databaseGlobal.__optraDatabaseConnection = undefined;
  if (active) await (await active).close();
}
