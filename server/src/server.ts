import { createServer } from 'node:http';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { logger } from './config/logger';
import { startScheduler } from './jobs/scheduler';
import { createSocketServer } from './sockets';

async function main(): Promise<void> {
  await connectDatabase();

  const app = createApp();
  const httpServer = createServer(app);
  const io = createSocketServer(httpServer);

  const stopJobs = env.JOBS_ENABLED ? startScheduler() : () => undefined;

  httpServer.listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening'));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    stopJobs();
    io.close();
    httpServer.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled promise rejection'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});
