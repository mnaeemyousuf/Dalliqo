/**
 * One-command local demo, no MongoDB installation needed:
 *
 *   npm run demo
 *
 * Starts an in-memory MongoDB replica set, seeds the demo agency and runs the
 * real API (with jobs and Socket.IO) on PORT (default 4000). Data is lost when
 * the process stops. For real use, run MongoDB (docker compose) and `npm run dev`.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

async function main() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGO_URI = replSet.getUri('recrm_demo');
  // `npm run demo --api-port=4100` when 4000 is busy.
  if (process.env.npm_config_api_port) process.env.PORT = process.env.npm_config_api_port;
  process.env.JWT_SECRET ??= 'demo-only-access-secret-change-me-0123456789';
  process.env.JWT_REFRESH_SECRET ??= 'demo-only-refresh-secret-change-me-012345678';
  process.env.NODE_ENV ??= 'development';
  process.env.CORS_ORIGINS ??= 'http://localhost:5173';

  // Imported only after the environment is set, because config is read at import time.
  const { connectDatabase } = await import('../config/database');
  const { seed, DEMO } = await import('./seed');
  await connectDatabase();
  const counts = await seed();
  console.log('\nDemo data:', counts);
  console.log(`Sign in at http://localhost:5173 (password ${DEMO.password}) as:`);
  console.log(`  owner    ${DEMO.ownerEmail}\n  member   ${DEMO.sonEmail}\n  manager  ${DEMO.managerEmail}`);
  console.log(`  agent    ${DEMO.agentEmail}\n  accounts ${DEMO.accountantEmail}\n  viewer   ${DEMO.viewerEmail}\n`);
  await import('../server');

  const stop = async () => {
    await replSet.stop();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
