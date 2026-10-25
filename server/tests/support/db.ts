import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { devOutbox } from '../../src/services/mailService';

// Each test file gets its own database on the shared in-memory replica set.
beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI!, { dbName: `test_${randomUUID().replace(/-/g, '')}` });
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  devOutbox.length = 0;
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
