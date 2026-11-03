import { Schema, model, type Types } from 'mongoose';
import { AGREEMENT_KINDS, AGREEMENT_LANGUAGES, AGREEMENT_STATUSES, type AgreementKind, type AgreementLanguage, type AgreementStatus } from '@recrm/shared';
import { branchField, branchIndexes, tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

export interface AgreementVersion {
  no: number;
  body: string;
  /** RENDER = filled from the template; EDIT = text changed by hand. */
  source: 'RENDER' | 'EDIT';
  createdAt: Date;
  createdBy: Types.ObjectId;
}

/**
 * Sale / rent / token agreement. Every render or hand edit is kept as a numbered version (the PDF prints
 * any version); signed, expired and cancelled agreements are locked. Rent agreements with an end date
 * get renewal follow-ups 30 and 7 days before it.
 */
export interface AgreementDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  agreementNo: string;
  templateId?: Types.ObjectId | null;
  kind: AgreementKind;
  language: AgreementLanguage;
  title?: string;
  status: AgreementStatus;
  dealId?: Types.ObjectId | null;
  clientId: Types.ObjectId;
  ownerId?: Types.ObjectId | null;
  propertyId?: Types.ObjectId | null;
  amount?: number | null;
  tokenAmount?: number | null;
  monthlyRent?: number | null;
  securityDeposit?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
  clientCnic?: string;
  ownerCnic?: string;
  witness1?: string;
  witness2?: string;
  notes?: string;
  versions: AgreementVersion[];
  signedDocumentId?: Types.ObjectId | null;
  signedAt?: Date | null;
  renewalFollowUpIds: Types.ObjectId[];
  statusHistory: { status: AgreementStatus; at: Date; by: Types.ObjectId; note?: string }[];
  searchText: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const money = { type: Number, min: 0, default: null };

const schema = new Schema<AgreementDoc>(
  {
    ...tenantFields,
    ...syncFields,
    ...branchField,
    agreementNo: { type: String, required: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'AgreementTemplate', default: null },
    kind: { type: String, enum: AGREEMENT_KINDS, required: true },
    language: { type: String, enum: AGREEMENT_LANGUAGES, default: 'en' },
    title: { type: String, trim: true, maxlength: 150 },
    status: { type: String, enum: AGREEMENT_STATUSES, default: 'DRAFT' },
    dealId: { type: Schema.Types.ObjectId, ref: 'Deal', default: null },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'PropertyOwner', default: null },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', default: null },
    amount: money,
    tokenAmount: money,
    monthlyRent: money,
    securityDeposit: money,
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    clientCnic: { type: String, maxlength: 20 },
    ownerCnic: { type: String, maxlength: 20 },
    witness1: { type: String, maxlength: 150 },
    witness2: { type: String, maxlength: 150 },
    notes: { type: String, maxlength: 2000 },
    versions: [
      new Schema<AgreementVersion>(
        {
          no: { type: Number, required: true },
          body: { type: String, required: true, maxlength: 40_000 },
          source: { type: String, enum: ['RENDER', 'EDIT'], default: 'RENDER' },
          createdAt: { type: Date, default: () => new Date() },
          createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        },
        { _id: false },
      ),
    ],
    signedDocumentId: { type: Schema.Types.ObjectId, ref: 'Document', default: null },
    signedAt: { type: Date, default: null },
    renewalFollowUpIds: [{ type: Schema.Types.ObjectId, ref: 'FollowUp' }],
    statusHistory: [
      new Schema(
        { status: { type: String, enum: AGREEMENT_STATUSES, required: true }, at: { type: Date, required: true }, by: { type: Schema.Types.ObjectId, ref: 'User' }, note: String },
        { _id: false },
      ),
    ],
    searchText: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
branchIndexes(schema);
schema.index({ businessId: 1, agreementNo: 1 }, { unique: true });
schema.index({ businessId: 1, deletedAt: 1, status: 1, updatedAt: -1 });
schema.index({ businessId: 1, kind: 1, endDate: 1 });
schema.index({ businessId: 1, clientId: 1 });
schema.index({ businessId: 1, propertyId: 1 });
schema.index({ businessId: 1, dealId: 1 });
schema.plugin(tenantGuardPlugin);

export const Agreement = model<AgreementDoc>('Agreement', schema, 'agreements');
