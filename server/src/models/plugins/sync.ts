import { randomUUID } from 'node:crypto';
import type { Schema } from 'mongoose';

/**
 * Fields for entities the mobile app edits offline. `uuid` is generated on the
 * device so an offline create can be replayed safely; `version` increments on
 * every write for optimistic concurrency; `deletedAt` is a tombstone so
 * deletions reach other devices through sync.
 */
export const syncFields = {
  uuid: { type: String, required: true, immutable: true, default: () => randomUUID() },
  version: { type: Number, default: 1, min: 1 },
  deletedAt: { type: Date, default: null },
} as const;

export interface SyncDoc {
  uuid: string;
  version: number;
  deletedAt?: Date | null;
}

/** Indexes every syncable collection needs: idempotent creates and the pull cursor. */
export function syncIndexes(schema: Schema): void {
  schema.index({ businessId: 1, uuid: 1 }, { unique: true });
  schema.index({ businessId: 1, updatedAt: 1, _id: 1 });
}
