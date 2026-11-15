import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { env } from './env.ts';
import { ensureDemoUsers } from './seed.ts';

let memoryServer: MongoMemoryServer | null = null;
let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    let uri = env.mongodbUri;

    if (!uri) {
      const dbPath = path.resolve(process.cwd(), '.data', 'mongodb');
      fs.mkdirSync(dbPath, { recursive: true });
      try {
        memoryServer = await MongoMemoryServer.create({
          instance: {
            dbPath,
            storageEngine: 'wiredTiger',
          },
        });
      } catch {
        memoryServer = await MongoMemoryServer.create();
      }
      uri = memoryServer.getUri();
      console.log('[DB] Using local MongoDB instance via mongodb-memory-server');
    } else {
      console.log('[DB] Connecting to configured MONGODB_URI');
    }

    mongoose.set('strictQuery', true);
    const conn = await mongoose.connect(uri, {
      autoIndex: true,
    });
    console.log('[DB] MongoDB connected');
    await ensureDemoUsers();
    console.log('[DB] Demo users verified in database');
    return conn;
  })();

  try {
    return await connectionPromise;
  } catch (error) {
    connectionPromise = null;
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
