import { MongoMemoryReplSet } from 'mongodb-memory-server';

// A single-node replica set, because registration and member creation use
// multi-document transactions exactly as they do in production.
export default async function globalSetup(): Promise<void> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  (globalThis as unknown as { __MONGO__: MongoMemoryReplSet }).__MONGO__ = replSet;
  process.env.TEST_MONGO_URI = replSet.getUri();
}
