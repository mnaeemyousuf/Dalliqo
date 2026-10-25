import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { SOCKET_EVENTS, type ChangeNotice } from '@recrm/shared';
import { corsOrigins } from '../config/env';
import { logger } from '../config/logger';
import { resolveAuthContext } from '../services/authContextService';
import { tokenService } from '../services/tokenService';
import type { AuthContext } from '../types/context';
import { AppError } from '../utils/AppError';
import { eventBus, type DomainEvent } from '../utils/eventBus';

export const businessRoom = (businessId: string) => `business:${businessId}`;
export const userRoom = (userId: string) => `user:${userId}`;

interface SocketData {
  auth: AuthContext;
}

/**
 * Real-time gateway. Sockets authenticate with the same access token as the
 * REST API and are placed in their business room (tenant isolation) and a
 * personal room (targeted notifications). Clients treat every event as a
 * change notice and re-fetch through the REST API, so permissions and tenant
 * scoping are always enforced by the normal request path.
 */
export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server<Record<string, never>, Record<string, (p: ChangeNotice) => void>, Record<string, never>, SocketData>(
    httpServer,
    {
      cors: { origin: corsOrigins, credentials: true },
      serveClient: false,
      pingInterval: 25_000,
      pingTimeout: 20_000,
    },
  );

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      if (!token) throw new Error('missing token');
      const auth = await resolveAuthContext(tokenService.verifyAccessToken(token));
      if (auth.mustChangePassword) throw new Error('password change required');
      socket.data.auth = auth;
      next();
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'UNAUTHENTICATED';
      const e = new Error('Unauthorized') as Error & { data?: unknown };
      e.data = { code };
      next(e);
    }
  });

  io.on('connection', (socket: Socket) => {
    const { auth } = socket.data as SocketData;
    void socket.join([businessRoom(auth.businessId), userRoom(auth.userId)]);
    logger.debug({ userId: auth.userId, businessId: auth.businessId }, 'socket connected');
  });

  const unsubscribe = eventBus.subscribe((event: DomainEvent) => deliver(io, event));
  io.engine.on('close', unsubscribe);
  httpServer.on('close', unsubscribe);

  return io;
}

function deliver(io: Server, event: DomainEvent): void {
  const notice: ChangeNotice = {
    entity: event.entity,
    id: event.entityId,
    version: event.version,
    actorUserId: event.actorUserId,
    at: new Date().toISOString(),
    data: event.data,
  };

  if (event.name === SOCKET_EVENTS.SESSION_REVOKED && event.targetUserId) {
    const sessionId = event.data?.sessionId as string | undefined;
    for (const socket of io.sockets.sockets.values()) {
      const auth = (socket.data as SocketData).auth;
      if (auth?.userId !== event.targetUserId) continue;
      if (sessionId && auth.sessionId !== sessionId) continue;
      socket.emit(event.name, notice);
      socket.disconnect(true);
    }
    return;
  }

  const room = event.targetUserId ? userRoom(event.targetUserId) : businessRoom(event.businessId);
  io.to(room).emit(event.name, notice);
}
