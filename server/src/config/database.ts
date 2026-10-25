import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

mongoose.set('strictQuery', true);

export async function connectDatabase(uri: string = env.MONGO_URI): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, {
    autoIndex: env.MONGO_AUTO_INDEX,
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info({ db: conn.connection.name }, 'MongoDB connected');
  return conn;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}
