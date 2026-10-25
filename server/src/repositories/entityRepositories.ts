import { ERROR_CODES } from '@recrm/shared';
import { Client, type ClientDoc } from '../models/Client';
import { ClientCategory, type ClientCategoryDoc } from '../models/ClientCategory';
import { FollowUp, type FollowUpDoc } from '../models/FollowUp';
import { Note, type NoteDoc } from '../models/Note';
import { Property, type PropertyDoc } from '../models/Property';
import { PropertyOwner, type PropertyOwnerDoc } from '../models/PropertyOwner';
import { createTenantRepository } from './tenantRepository';

export const categoryRepository = createTenantRepository<ClientCategoryDoc>(ClientCategory, ERROR_CODES.CATEGORY_NOT_FOUND);
export const clientRepository = createTenantRepository<ClientDoc>(Client, ERROR_CODES.CLIENT_NOT_FOUND);
export const ownerRepository = createTenantRepository<PropertyOwnerDoc>(PropertyOwner, ERROR_CODES.OWNER_NOT_FOUND);
export const propertyRepository = createTenantRepository<PropertyDoc>(Property, ERROR_CODES.PROPERTY_NOT_FOUND);
export const noteRepository = createTenantRepository<NoteDoc>(Note, ERROR_CODES.NOTE_NOT_FOUND);
export const followUpRepository = createTenantRepository<FollowUpDoc>(FollowUp, ERROR_CODES.FOLLOWUP_NOT_FOUND);
