import type { ClientSession } from 'mongoose';
import { Business, type BusinessDoc } from '../models/Business';
import type { TenantContext } from '../types/context';

type NewBusiness = Pick<BusinessDoc, '_id' | 'name' | 'ownerUserId' | 'createdBy' | 'updatedBy'> & Partial<BusinessDoc>;

export const businessRepository = {
  async create(data: NewBusiness, session?: ClientSession): Promise<BusinessDoc> {
    const [doc] = await Business.create([data], { session });
    return doc.toObject();
  },

  /** A tenant may only ever load its own business document. */
  findCurrent(ctx: TenantContext) {
    return Business.findById(ctx.businessId).lean<BusinessDoc>();
  },

  updateCurrent(ctx: TenantContext, update: Partial<BusinessDoc>) {
    return Business.findByIdAndUpdate(
      ctx.businessId,
      { $set: { ...update, updatedBy: ctx.userId } },
      { new: true, runValidators: true },
    ).lean<BusinessDoc>();
  },
};
