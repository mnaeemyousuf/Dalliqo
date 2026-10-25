import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { logger } from '../config/logger';
import { JobLock } from '../models/SyncRecord';
import { followUpService } from '../services/followUpService';

const OWNER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

/**
 * Lease lock in MongoDB so that, with several API instances, each job runs on
 * exactly one of them per tick.
 */
async function acquire(name: string, leaseMs: number): Promise<boolean> {
  const now = new Date();
  try {
    const res = await JobLock.findOneAndUpdate(
      { _id: name, $or: [{ lockedUntil: { $lt: now } }, { owner: OWNER }] },
      { $set: { lockedUntil: new Date(now.getTime() + leaseMs), owner: OWNER } },
      { upsert: true, new: true },
    ).lean();
    return res?.owner === OWNER;
  } catch (err) {
    // Duplicate key on upsert = another instance holds the lock.
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<number>;
}

export const JOBS: Job[] = [
  { name: 'followup-reminders', everyMs: 60_000, run: () => followUpService.sendDueReminders() },
  { name: 'followup-overdue', everyMs: 5 * 60_000, run: () => followUpService.markOverdue() },
];

export function startScheduler(): () => void {
  const timers = JOBS.map((job) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        if (await acquire(job.name, job.everyMs - 1_000)) {
          const n = await job.run();
          if (n) logger.info({ job: job.name, processed: n }, 'Job ran');
        }
      } catch (err) {
        logger.error({ err, job: job.name }, 'Job failed');
      } finally {
        running = false;
      }
    };
    void tick();
    return setInterval(tick, job.everyMs);
  });
  logger.info({ jobs: JOBS.map((j) => j.name) }, 'Scheduler started');
  return () => timers.forEach(clearInterval);
}
