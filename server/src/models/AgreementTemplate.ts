import { Schema, model, type Types } from 'mongoose';
import { AGREEMENT_KINDS, AGREEMENT_LANGUAGES, type AgreementKind, type AgreementLanguage } from '@recrm/shared';
import { tenantFields, tenantGuardPlugin } from './plugins/tenant';
import { syncFields, syncIndexes, type SyncDoc } from './plugins/sync';

/** Agreement text with {{placeholders}}. Built-ins (EN + UR for sale, rent, token) are seeded per business. */
export interface AgreementTemplateDoc extends SyncDoc {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  key?: string;
  name: string;
  kind: AgreementKind;
  language: AgreementLanguage;
  body: string;
  builtIn: boolean;
  archivedAt?: Date | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<AgreementTemplateDoc>(
  {
    ...tenantFields,
    ...syncFields,
    key: { type: String },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    kind: { type: String, enum: AGREEMENT_KINDS, required: true },
    language: { type: String, enum: AGREEMENT_LANGUAGES, required: true },
    body: { type: String, required: true, maxlength: 30_000 },
    builtIn: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

syncIndexes(schema);
schema.index({ businessId: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $type: 'string' } } });
schema.index({ businessId: 1, kind: 1, language: 1 });
schema.plugin(tenantGuardPlugin);

export const AgreementTemplate = model<AgreementTemplateDoc>('AgreementTemplate', schema, 'agreementTemplates');
