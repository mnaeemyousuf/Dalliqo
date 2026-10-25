/** Socket.IO event names emitted by the API to business and user rooms. */
export const SOCKET_EVENTS = {
  CLIENT_CREATED: 'client.created',
  CLIENT_UPDATED: 'client.updated',
  CLIENT_DELETED: 'client.deleted',
  PROPERTY_CREATED: 'property.created',
  PROPERTY_UPDATED: 'property.updated',
  PROPERTY_STATUS_CHANGED: 'property.statusChanged',
  PROPERTY_DELETED: 'property.deleted',
  OWNER_CREATED: 'owner.created',
  OWNER_UPDATED: 'owner.updated',
  MATCH_CREATED: 'match.created',
  FOLLOWUP_CREATED: 'followup.created',
  FOLLOWUP_UPDATED: 'followup.updated',
  FOLLOWUP_COMPLETED: 'followup.completed',
  NOTIFICATION_CREATED: 'notification.created',
  MEMBER_CREATED: 'member.created',
  MEMBER_UPDATED: 'member.updated',
  BUSINESS_UPDATED: 'business.updated',
  /** Sent to a single user's sockets right before the server disconnects them. */
  SESSION_REVOKED: 'session.revoked',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/**
 * Every realtime payload is a lightweight change notice. Clients re-fetch (web)
 * or pull a delta (mobile) rather than trusting the payload as the full record.
 */
export interface ChangeNotice {
  entity: string;
  id: string;
  version?: number;
  actorUserId: string;
  at: string;
  data?: Record<string, unknown>;
}
