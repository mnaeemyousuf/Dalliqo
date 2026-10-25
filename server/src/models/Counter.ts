import { Schema, model, type ClientSession } from 'mongoose';

/**
 * Atomic per-business sequences (e.g. property IDs RE-000001). Keyed by
 * `${businessId}:${name}` so each business gets its own numbering.
 */
interface CounterDoc {
  _id: string;
  seq: number;
}

const schema = new Schema<CounterDoc>({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } }, {
  versionKey: false,
});

export const Counter = model<CounterDoc>('Counter', schema, 'counters');

export async function nextSequence(businessId: string, name: string, session?: ClientSession): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: `${businessId}:${name}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session },
  ).lean();
  return doc!.seq;
}
