import { Schema, model } from 'mongoose';
import { logger } from '../config/logger';
import { migrateBranches } from './001-branches';
import { migrateFinanceCategories } from './002-finance-categories';

/** One row per migration run (history; every migration is also idempotent on its own). */
const MigrationRun = model(
  'MigrationRun',
  new Schema({ name: { type: String, required: true }, result: Schema.Types.Mixed, ranAt: { type: Date, default: () => new Date() } }, { versionKey: false }),
  'migrations',
);

const MIGRATIONS: { name: string; run: () => Promise<unknown> }[] = [
  { name: '001-branches', run: migrateBranches },
  { name: '002-finance-categories', run: migrateFinanceCategories },
];

/**
 * Runs every migration. Called at API start-up (after the database connects) and by
 * `npm run migrate -w @recrm/server`. Safe to run any number of times.
 */
export async function runMigrations(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const m of MIGRATIONS) {
    const result = await m.run();
    results[m.name] = result;
    await MigrationRun.create({ name: m.name, result });
    logger.info({ migration: m.name, result }, 'Migration finished');
  }
  return results;
}
