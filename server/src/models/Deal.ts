import { randomUUID } from 'node:crypto';
import { Schema, model, type Types } from 'mongoose';
import {
  APPROVAL_STATUSES,
  EXTERNAL_SHARE_KINDS,
  type ExternalShareKind,
  type ApprovalStatus,
  OFFER_PARTIES,
  OFFER_STATUSES,
  type OfferParty,
  type OfferStatus,
  COMMISSION_MODES,
  COMMISSION_STATUSES,
  DEAL_SIDES,
  DEAL_STAGES,
  PAYMENT_METHODS,
  PAYOUT_STATUSES,
  type CommissionMode,
  type CommissionStatus,
  type DealSide,
  type DealStage,
  type PaymentMethod,
  type PayoutStatus,
} from '@recrm/shared';
import { branchField, branchIndexes, tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

export interface DealPayment {
  /** Device-generatable id so a payment recorded offline is never applied twice. */
  _id: string;
  side: DealSide;
  amount: number;
  date: Date;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  /** Income transaction recorded for this payment (B2), if any. */
  transactionId?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
}

export interface DealOffer {
  _id: string;
  party: OfferParty;
  amount: number;
  status: OfferStatus;
  note?: string;
  at: Date;
  by?: Types.ObjectId;
}

export interface DealChecklistEntry {
  key: string;
  label?: string;
  done: boolean;
  doneAt?: Date | null;
  doneBy?: Types.ObjectId | null;
}

export interface DealPayout {
  _id: string;
  userId: Types.ObjectId;
  amount: number;
  date?: Date | null;
  status: PayoutStatus;
  notes?: string;
}

export interface DealDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  /** Human id, e.g. DL-000012. */
  dealNo: string;
  title?: string;
  clientId: Types.ObjectId;
  propertyId?: Types.ObjectId | null;
  agents: { userId: Types.ObjectId; sharePct: number }[];
  stage: DealStage;
  lostReason?: string;
  stageHistory: { stage: DealStage; at: Date; by: Types.ObjectId; note?: string }[];
  /** Owner's asking price when negotiation started (snapshot from the property). */
  initialAskingPrice?: number;
  offers: DealOffer[];
  tokenAmount?: number;
  checklist: DealChecklistEntry[];
  externalShares: { _id: string; kind: ExternalShareKind; name: string; mode: CommissionMode; value: number; paid: number }[];
  commissionApprovedAt?: Date | null;
  commissionApprovedBy?: Types.ObjectId | null;
  /** Pending request to close the deal as won (when approvals are required). */
  approval?: { status: ApprovalStatus; action: 'CLOSE_WON'; requestedBy?: Types.ObjectId; requestedAt?: Date; decidedBy?: Types.ObjectId | null; decidedAt?: Date | null; note?: string | null } | null;
  agreedPrice?: number;
  finalPrice?: number;
  expectedCloseDate?: Date | null;
  closedAt?: Date | null;
  notes?: string;
  commission: { buyer: { mode: CommissionMode; value: number }; seller: { mode: CommissionMode; value: number } };
  payments: DealPayment[];
  payouts: DealPayout[];
  // Denormalised from summarizeCommission() for lists, filters and reports.
  expectedTotal: number;
  receivedTotal: number;
  outstanding: number;
  commissionStatus: CommissionStatus;
  searchText: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const term = {
  mode: { type: String, enum: COMMISSION_MODES, default: 'PERCENT' },
  value: { type: Number, default: 0, min: 0 },
};

const schema = new Schema<DealDoc>(
  {
    ...tenantFields,
    ...syncFields,
    ...branchField,
    dealNo: { type: String, required: true, immutable: true },
    title: { type: String, trim: true, maxlength: 150 },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    agents: {
      type: [{ _id: false, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, sharePct: { type: Number, required: true, min: 0, max: 100 } }],
      default: [],
    },
    stage: { type: String, enum: DEAL_STAGES, default: 'INQUIRY' },
    lostReason: { type: String, maxlength: 500 },
    stageHistory: {
      type: [{ _id: false, stage: { type: String, enum: DEAL_STAGES, required: true }, at: { type: Date, required: true }, by: { type: Schema.Types.ObjectId, ref: 'User' }, note: String }],
      default: [],
    },
    initialAskingPrice: { type: Number, min: 0 },
    offers: {
      type: [
        {
          _id: { type: String, default: () => randomUUID() },
          party: { type: String, enum: OFFER_PARTIES, required: true },
          amount: { type: Number, required: true, min: 1 },
          status: { type: String, enum: OFFER_STATUSES, default: 'OPEN' },
          note: { type: String, maxlength: 500 },
          at: { type: Date, required: true },
          by: { type: Schema.Types.ObjectId, ref: 'User' },
        },
      ],
      default: [],
    },
    tokenAmount: { type: Number, min: 0 },
    externalShares: {
      type: [
        {
          _id: { type: String, default: () => randomUUID() },
          kind: { type: String, enum: EXTERNAL_SHARE_KINDS, required: true },
          name: { type: String, required: true, maxlength: 120 },
          mode: { type: String, enum: COMMISSION_MODES, default: 'PERCENT' },
          value: { type: Number, required: true, min: 0 },
          paid: { type: Number, default: 0, min: 0 },
        },
      ],
      default: [],
    },
    commissionApprovedAt: { type: Date, default: null },
    commissionApprovedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approval: {
      type: new Schema(
        {
          status: { type: String, enum: APPROVAL_STATUSES, required: true },
          action: { type: String, enum: ['CLOSE_WON'], required: true },
          requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
          requestedAt: Date,
          decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          decidedAt: { type: Date, default: null },
          note: { type: String, maxlength: 500, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    checklist: {
      type: [
        {
          _id: false,
          key: { type: String, required: true, maxlength: 60 },
          label: { type: String, maxlength: 120 },
          done: { type: Boolean, default: false },
          doneAt: { type: Date, default: null },
          doneBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        },
      ],
      default: [],
    },
    agreedPrice: { type: Number, min: 0 },
    finalPrice: { type: Number, min: 0 },
    expectedCloseDate: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    notes: { type: String, maxlength: 2000 },
    commission: { buyer: term, seller: term },
    payments: {
      type: [
        {
          _id: { type: String, default: () => randomUUID() },
          side: { type: String, enum: DEAL_SIDES, required: true },
          amount: { type: Number, required: true, min: 1 },
          date: { type: Date, required: true },
          method: { type: String, enum: PAYMENT_METHODS, default: 'CASH' },
          reference: { type: String, maxlength: 100 },
          notes: { type: String, maxlength: 500 },
          transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null },
          createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
        },
      ],
      default: [],
    },
    payouts: {
      type: [
        {
          _id: { type: String, default: () => randomUUID() },
          userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          amount: { type: Number, required: true, min: 1 },
          date: { type: Date, default: null },
          status: { type: String, enum: PAYOUT_STATUSES, default: 'PENDING' },
          notes: { type: String, maxlength: 500 },
        },
      ],
      default: [],
    },
    expectedTotal: { type: Number, default: 0 },
    receivedTotal: { type: Number, default: 0 },
    outstanding: { type: Number, default: 0 },
    commissionStatus: { type: String, enum: COMMISSION_STATUSES, default: 'PENDING' },
    searchText: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
branchIndexes(schema);
schema.index({ businessId: 1, dealNo: 1 }, { unique: true });
schema.index({ businessId: 1, deletedAt: 1, stage: 1, updatedAt: -1 });
schema.index({ businessId: 1, 'agents.userId': 1, stage: 1 });
schema.index({ businessId: 1, clientId: 1 });
schema.index({ businessId: 1, propertyId: 1 });
schema.index({ businessId: 1, commissionStatus: 1 });
schema.index({ businessId: 1, 'payments.date': 1 });
schema.index({ businessId: 1, searchText: 1 });
schema.plugin(tenantGuardPlugin);

export const Deal = model<DealDoc>('Deal', schema, 'deals');
