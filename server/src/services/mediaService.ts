import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ERROR_CODES, type DocumentCategory, type DocumentEntityType, type MediaKind } from '@recrm/shared';
import { env } from '../config/env';
import { Document, PropertyMedia, type FileAssetDoc } from '../models/FileAsset';
import { propertyRepository } from '../repositories/entityRepositories';
import type { AuthContext, TenantContext } from '../types/context';
import { AppError, badRequest, notFound } from '../utils/AppError';
import { activityService } from './activityService';
import { auditService } from './auditService';
import { assertEntity } from './noteService';
import { propertyService } from './propertyService';
import { storage, type ResourceType } from './storage/storage';
import { DOCUMENT_MIMES as DOC_MIMES, IMAGE_MIMES, VIDEO_MIMES } from '../constants';

// file-type v16 is CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FileType = require('file-type') as { fromBuffer(b: Buffer): Promise<{ ext: string; mime: string } | undefined> };

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}


const MB = 1024 * 1024;

/** Detects the real type from the file's bytes; the extension and client-sent MIME are ignored. */
async function sniff(file: UploadedFile): Promise<{ ext: string; mime: string }> {
  const t = await FileType.fromBuffer(file.buffer);
  if (!t) throw badRequest(ERROR_CODES.INVALID_FILE, `Unsupported or unrecognised file: ${file.originalname}`);
  return t;
}

function kindOf(mime: string): MediaKind {
  if (IMAGE_MIMES.includes(mime)) return 'image';
  if (VIDEO_MIMES.includes(mime)) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}

function resourceTypeOf(kind: MediaKind): ResourceType {
  return kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'raw';
}

function assertSize(file: UploadedFile, kind: MediaKind, isDocument: boolean) {
  const limitMb = kind === 'video' ? env.MAX_VIDEO_MB : isDocument ? env.MAX_DOCUMENT_MB : env.MAX_IMAGE_MB;
  if (file.size > limitMb * MB) {
    throw new AppError(413, ERROR_CODES.FILE_TOO_LARGE, `${file.originalname} is larger than ${limitMb} MB`);
  }
}

/** Display name without path components or control characters. */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim();
  return (cleaned || 'file').slice(0, 200);
}

interface Processed {
  main: Buffer;
  ext: string;
  mime: string;
  thumb?: Buffer;
  width?: number;
  height?: number;
}

/** Images are auto-rotated, capped at 2048 px and recompressed; a 480 px thumbnail is generated. */
async function processImage(buffer: Buffer, mime: string): Promise<Processed> {
  const img = sharp(buffer, { failOn: 'error' }).rotate();
  const asWebp = mime === 'image/webp';
  const main = await img
    .clone()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    [asWebp ? 'webp' : 'jpeg']({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await img.clone().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
  return {
    main: main.data,
    ext: asWebp ? 'webp' : 'jpg',
    mime: asWebp ? 'image/webp' : 'image/jpeg',
    thumb,
    width: main.info.width,
    height: main.info.height,
  };
}

async function storeFile(
  ctx: TenantContext,
  folder: string,
  file: UploadedFile,
  detected: { ext: string; mime: string },
  isPrivate: boolean,
) {
  const kind = kindOf(detected.mime);
  const processed: Processed = kind === 'image' ? await processImage(file.buffer, detected.mime) : { main: file.buffer, ext: detected.ext, mime: detected.mime };
  const id = randomUUID();
  const key = `${ctx.businessId}/${folder}/${id}.${processed.ext}`;
  const provider = storage();
  const stored = await provider.put(key, processed.main, { mimeType: processed.mime, isPrivate, resourceType: resourceTypeOf(kind) });

  let thumbnailKey: string | undefined;
  let thumbnailUrl: string | undefined;
  if (processed.thumb) {
    thumbnailKey = `${ctx.businessId}/${folder}/${id}-thumb.jpg`;
    const t = await provider.put(thumbnailKey, processed.thumb, { mimeType: 'image/jpeg', isPrivate, resourceType: 'image' });
    thumbnailUrl = t.url;
  } else if (kind === 'video' && !isPrivate) {
    thumbnailUrl = provider.videoThumbnailUrl?.(key);
  }
  return {
    kind,
    storageKey: key,
    storageProvider: provider.name,
    fileUrl: stored.url,
    thumbnailKey,
    thumbnailUrl,
    mimeType: processed.mime,
    fileSize: processed.main.length,
    width: processed.width,
    height: processed.height,
  };
}

async function removeStored(f: FileAssetDoc) {
  const provider = storage();
  await provider.remove(f.storageKey, { resourceType: resourceTypeOf(f.kind), isPrivate: f.isPrivate }).catch(() => undefined);
  if (f.thumbnailKey) await provider.remove(f.thumbnailKey, { resourceType: 'image', isPrivate: f.isPrivate }).catch(() => undefined);
}

function withUrls(f: FileAssetDoc) {
  if (!f.isPrivate) return f;
  const provider = storage();
  return {
    ...f,
    thumbnailUrl: f.thumbnailKey ? provider.signedUrl(f.thumbnailKey, { resourceType: 'image', mimeType: 'image/jpeg', expiresInSec: 3600 }) : undefined,
  };
}

export const mediaService = {
  // ── Property gallery (images & videos, public URLs) ──

  async uploadPropertyMedia(auth: AuthContext, propertyId: string, files: UploadedFile[]) {
    const property = await propertyRepository.getById(auth, propertyId, 'Property not found');
    if (!files.length) throw badRequest(ERROR_CODES.INVALID_FILE, 'No files received');
    const detected = await Promise.all(files.map(sniff));
    detected.forEach((d, i) => {
      if (![...IMAGE_MIMES, ...VIDEO_MIMES].includes(d.mime)) {
        throw badRequest(ERROR_CODES.INVALID_FILE, `${files[i].originalname}: only JPEG, PNG, WebP images and MP4/MOV/WebM videos are allowed`);
      }
      assertSize(files[i], kindOf(d.mime), false);
    });

    const last = await PropertyMedia.findOne({ businessId: auth.businessId, entityId: property._id, deletedAt: null }).sort({ sortOrder: -1 }).lean();
    let order = (last?.sortOrder ?? -1) + 1;
    const created: FileAssetDoc[] = [];
    for (let i = 0; i < files.length; i++) {
      const stored = await storeFile(auth, 'media', files[i], detected[i], false);
      const doc = await PropertyMedia.create({
        ...stored,
        businessId: auth.businessId,
        entityType: 'property',
        entityId: property._id,
        fileName: safeDisplayName(files[i].originalname),
        sortOrder: order++,
        isPrivate: false,
        uploadedBy: auth.userId,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      });
      created.push(doc.toObject());
    }
    if (!property.coverImageUrl) {
      const firstImage = created.find((c) => c.kind === 'image');
      if (firstImage) await propertyService.setCover(auth, propertyId, firstImage.fileUrl, firstImage.thumbnailUrl);
    }
    await activityService.record(auth, 'MEDIA_UPLOADED', `${created.length} file(s) added to ${property.propertyId}`, [
      { entityType: 'property', entityId: property._id, label: property.propertyId },
    ]);
    return created;
  },

  listPropertyMedia(ctx: TenantContext, propertyId: string) {
    return PropertyMedia.find({ businessId: ctx.businessId, entityId: propertyId, deletedAt: null }).sort({ sortOrder: 1 }).lean<FileAssetDoc[]>();
  },

  async updateMedia(auth: AuthContext, id: string, input: { sortOrder?: number; setCover?: boolean }) {
    const m = await PropertyMedia.findOneAndUpdate(
      { businessId: auth.businessId, _id: id, deletedAt: null },
      { $set: { ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}), updatedBy: auth.userId } },
      { new: true },
    ).lean<FileAssetDoc>();
    if (!m) throw notFound(ERROR_CODES.MEDIA_NOT_FOUND, 'Media not found');
    if (input.setCover) {
      if (m.kind !== 'image') throw badRequest(ERROR_CODES.INVALID_FILE, 'Only images can be the cover');
      await propertyService.setCover(auth, m.entityId.toString(), m.fileUrl, m.thumbnailUrl);
    }
    return m;
  },

  async removeMedia(auth: AuthContext, id: string) {
    const m = await PropertyMedia.findOneAndUpdate(
      { businessId: auth.businessId, _id: id, deletedAt: null },
      { $set: { deletedAt: new Date(), updatedBy: auth.userId } },
      { new: true },
    ).lean<FileAssetDoc>();
    if (!m) throw notFound(ERROR_CODES.MEDIA_NOT_FOUND, 'Media not found');
    await removeStored(m);
    const property = await propertyRepository.findById(auth, m.entityId.toString());
    if (property?.coverImageUrl && property.coverImageUrl === m.fileUrl) {
      const next = await PropertyMedia.findOne({ businessId: auth.businessId, entityId: m.entityId, deletedAt: null, kind: 'image' }).sort({ sortOrder: 1 }).lean();
      await propertyService.setCover(auth, m.entityId.toString(), next?.fileUrl, next?.thumbnailUrl);
    }
  },

  // ── Documents (private; signed URLs only) ──

  async uploadDocument(
    auth: AuthContext,
    input: { entityType: DocumentEntityType; entityId: string; category?: DocumentCategory; fileName?: string },
    file: UploadedFile | undefined,
  ) {
    if (!file) throw badRequest(ERROR_CODES.INVALID_FILE, 'No file received');
    const label = await assertEntity(auth, input.entityType, input.entityId);
    const detected = await sniff(file);
    if (!DOC_MIMES.includes(detected.mime)) {
      throw badRequest(ERROR_CODES.INVALID_FILE, 'Only PDF, JPEG, PNG, WebP, Word (.docx) and Excel (.xlsx) files are allowed');
    }
    assertSize(file, kindOf(detected.mime), true);
    const stored = await storeFile(auth, 'docs', file, detected, true);
    const doc = await Document.create({
      ...stored,
      businessId: auth.businessId,
      entityType: input.entityType,
      entityId: input.entityId,
      category: input.category ?? 'OTHER',
      fileName: safeDisplayName(input.fileName ?? file.originalname),
      isPrivate: true,
      uploadedBy: auth.userId,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
    await activityService.record(auth, 'DOCUMENT_UPLOADED', `Document "${doc.fileName}" uploaded for ${label}`, [
      { entityType: input.entityType, entityId: input.entityId, label },
    ], { documentId: doc._id.toString(), category: doc.category });
    await auditService.record(auth, { action: 'document.uploaded', entityType: 'document', entityId: doc._id, entityLabel: doc.fileName });
    return withUrls(doc.toObject());
  },

  async listDocuments(ctx: TenantContext, q: { entityType?: DocumentEntityType; entityId?: string; category?: DocumentCategory; page: number; limit: number }) {
    const filter: Record<string, unknown> = { businessId: ctx.businessId, deletedAt: null };
    if (q.entityType) filter.entityType = q.entityType;
    if (q.entityId) filter.entityId = q.entityId;
    if (q.category) filter.category = q.category;
    const [items, total] = await Promise.all([
      Document.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('uploadedBy', 'fullName').lean<FileAssetDoc[]>(),
      Document.countDocuments(filter),
    ]);
    return { items: items.map(withUrls), total };
  },

  async getDocument(ctx: TenantContext, id: string) {
    const d = await Document.findOne({ businessId: ctx.businessId, _id: id, deletedAt: null }).lean<FileAssetDoc>();
    if (!d) throw notFound(ERROR_CODES.DOCUMENT_NOT_FOUND, 'Document not found');
    return d;
  },

  /** Short-lived link for preview / download / share. */
  async downloadUrl(ctx: TenantContext, id: string, expiresInSec = 600) {
    const d = await this.getDocument(ctx, id);
    const url = storage().signedUrl(d.storageKey, { resourceType: resourceTypeOf(d.kind), mimeType: d.mimeType, expiresInSec, fileName: d.fileName });
    return { url, expiresAt: new Date(Date.now() + expiresInSec * 1000), fileName: d.fileName, mimeType: d.mimeType };
  },

  async updateDocument(auth: AuthContext, id: string, input: { fileName?: string; category?: DocumentCategory }) {
    const set: Record<string, unknown> = { updatedBy: auth.userId };
    if (input.fileName) set.fileName = safeDisplayName(input.fileName);
    if (input.category) set.category = input.category;
    const d = await Document.findOneAndUpdate({ businessId: auth.businessId, _id: id, deletedAt: null }, { $set: set }, { new: true }).lean<FileAssetDoc>();
    if (!d) throw notFound(ERROR_CODES.DOCUMENT_NOT_FOUND, 'Document not found');
    return withUrls(d);
  },

  async removeDocument(auth: AuthContext, id: string) {
    const d = await Document.findOneAndUpdate(
      { businessId: auth.businessId, _id: id, deletedAt: null },
      { $set: { deletedAt: new Date(), updatedBy: auth.userId } },
      { new: true },
    ).lean<FileAssetDoc>();
    if (!d) throw notFound(ERROR_CODES.DOCUMENT_NOT_FOUND, 'Document not found');
    await removeStored(d);
    await activityService.record(auth, 'DOCUMENT_DELETED', `Document "${d.fileName}" deleted`, [{ entityType: d.entityType, entityId: d.entityId }]);
    await auditService.record(auth, { action: 'document.deleted', entityType: 'document', entityId: d._id, entityLabel: d.fileName });
  },
};
