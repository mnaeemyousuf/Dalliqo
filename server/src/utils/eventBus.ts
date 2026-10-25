import { EventEmitter } from 'node:events';
import type { SocketEventName } from '@recrm/shared';
import { logger } from '../config/logger';

/**
 * In-process domain event bus. Services publish after a write commits;
 * the Socket.IO gateway, notification service and matching engine subscribe.
 * Keeping services unaware of transports means the same events can later be
 * routed through a broker (Redis / queue) when the API runs on several nodes.
 */
export interface DomainEvent {
  name: SocketEventName;
  businessId: string;
  actorUserId: string;
  entity: string;
  entityId: string;
  version?: number;
  /** Deliver only to this user's sockets instead of the whole business. */
  targetUserId?: string;
  data?: Record<string, unknown>;
}

class DomainEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  publish(event: DomainEvent): void {
    // Listeners must never break the request that produced the event.
    setImmediate(() => {
      try {
        this.emitter.emit('event', event);
      } catch (err) {
        logger.error({ err, event: event.name }, 'Domain event listener failed');
      }
    });
  }

  subscribe(listener: (event: DomainEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}

export const eventBus = new DomainEventBus();
