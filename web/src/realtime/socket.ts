import type { QueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { SOCKET_EVENTS, type ChangeNotice } from '@recrm/shared';
import { refreshAccessToken, tokenStore } from '@/api/client';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/toast';

export const useRealtime = create<{ connected: boolean }>(() => ({ connected: false }));

/** Which cached queries each event makes stale. Clients re-fetch through REST. */
const INVALIDATES: Record<string, string[][]> = {
  [SOCKET_EVENTS.CLIENT_CREATED]: [['clients'], ['dashboard'], ['myDay']],
  [SOCKET_EVENTS.CLIENT_UPDATED]: [['clients'], ['client'], ['activities']],
  [SOCKET_EVENTS.CLIENT_DELETED]: [['clients'], ['dashboard'], ['matches']],
  [SOCKET_EVENTS.PROPERTY_CREATED]: [['properties'], ['dashboard'], ['myDay']],
  [SOCKET_EVENTS.PROPERTY_UPDATED]: [['properties'], ['property'], ['activities']],
  [SOCKET_EVENTS.PROPERTY_STATUS_CHANGED]: [['properties'], ['property'], ['dashboard'], ['matches'], ['activities']],
  [SOCKET_EVENTS.PROPERTY_DELETED]: [['properties'], ['dashboard'], ['matches']],
  [SOCKET_EVENTS.OWNER_CREATED]: [['owners']],
  [SOCKET_EVENTS.OWNER_UPDATED]: [['owners'], ['owner']],
  [SOCKET_EVENTS.MATCH_CREATED]: [['matches'], ['clients'], ['properties'], ['client'], ['property'], ['dashboard'], ['myDay']],
  [SOCKET_EVENTS.FOLLOWUP_CREATED]: [['followups'], ['myDay'], ['dashboard'], ['activities']],
  [SOCKET_EVENTS.FOLLOWUP_UPDATED]: [['followups'], ['myDay'], ['dashboard']],
  [SOCKET_EVENTS.FOLLOWUP_COMPLETED]: [['followups'], ['myDay'], ['dashboard'], ['activities']],
  [SOCKET_EVENTS.NOTIFICATION_CREATED]: [['notifications']],
  [SOCKET_EVENTS.MEMBER_CREATED]: [['members']],
  [SOCKET_EVENTS.MEMBER_UPDATED]: [['members']],
  [SOCKET_EVENTS.BUSINESS_UPDATED]: [['business']],
};

let socket: Socket | null = null;

export function connectRealtime(queryClient: QueryClient): () => void {
  disconnectRealtime();
  socket = io({ path: '/socket.io', transports: ['websocket'], auth: (cb) => cb({ token: tokenStore.get() }) });

  socket.on('connect', () => useRealtime.setState({ connected: true }));
  socket.on('disconnect', () => useRealtime.setState({ connected: false }));
  socket.on('connect_error', async (err: Error & { data?: { code?: string } }) => {
    useRealtime.setState({ connected: false });
    // Expired access token: refresh and let socket.io retry with the new one.
    if (err.data?.code === 'TOKEN_EXPIRED' || err.data?.code === 'INVALID_TOKEN') {
      if (await refreshAccessToken()) socket?.connect();
    }
  });

  for (const [event, keys] of Object.entries(INVALIDATES)) {
    socket.on(event, (notice: ChangeNotice) => {
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: key });
      if (event === SOCKET_EVENTS.NOTIFICATION_CREATED && notice.data) {
        const d = notice.data as { title?: string; body?: string; deepLink?: string };
        toast.info(d.title ?? '', d.body, d.deepLink);
      }
    });
  }
  socket.on(SOCKET_EVENTS.SESSION_REVOKED, () => void useAuth.getState().signOut(false));

  return disconnectRealtime;
}

export function disconnectRealtime(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  useRealtime.setState({ connected: false });
}
