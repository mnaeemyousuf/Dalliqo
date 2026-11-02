/**
 * Runs the data migrations against MONGO_URI and exits:
 *
 *   npm run migrate -w @recrm/server
 *
 * Every migration is idempotent, so running this twice (or after the API already ran them at
 * start-up) is safe.
 */
import { connectDatabase, disconnectDatabase } from '../config/database';
import { runMigrations } from '../migrations';

async function main() {
  await connectDatabase();
  const results = await runMigrations();
  console.log(JSON.stringify(results, null, 2));
  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
