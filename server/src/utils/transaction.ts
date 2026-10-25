import mongoose, { type ClientSession } from 'mongoose';

/**
 * Runs fn inside a MongoDB transaction (requires a replica set — the docker
 * compose file and the test harness both run single-node replica sets).
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
