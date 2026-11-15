export {};

if (!process.env.DATABASE_URL?.trim()) {
  console.error("DATABASE_URL is required; refusing to run production migrations without an explicit PostgreSQL target.");
  process.exitCode = 1;
} else {
  const { closeDatabase, getDatabase } = await import("../lib/db/client");

  try {
    await getDatabase();
    console.log("Database migrations completed.");
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[DATABASE_URL]") : "Unknown database error.";
    console.error(`Database migrations failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
