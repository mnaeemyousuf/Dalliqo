import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { SOCKET_EVENTS } from '@recrm/shared';
import { createApp } from '../src/app';
import { createSocketServer } from '../src/sockets';
import { addActiveMember, bearer, registerOwner } from './support/helpers';

const app = createApp();
let httpServer: HttpServer;
let io: Server;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  httpServer = createServer(app);
  io = createSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(() => {
  sockets.splice(0).forEach((s) => s.disconnect());
});

afterAll(async () => {
  io.close();
  await new Promise((resolve) => httpServer.close(resolve));
});

function open(token?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function nextEvent<T = unknown>(s: Socket, name: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${name}`)), timeoutMs);
    s.once(name, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

describe('Socket.IO gateway', () => {
  it('refuses connections without a valid access token', async () => {
    await expect(open()).rejects.toThrow('Unauthorized');
    await expect(open('bogus')).rejects.toThrow('Unauthorized');
  });

  it("delivers a change made by the father to the son's device in real time, and not to other businesses", async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);
    const stranger = await registerOwner(app, { businessName: 'Another Agency' });

    const sonSocket = await open(son.accessToken);
    const strangerSocket = await open(stranger.accessToken);
    let strangerGotIt = false;
    strangerSocket.on(SOCKET_EVENTS.BUSINESS_UPDATED, () => (strangerGotIt = true));

    const received = nextEvent<{ entity: string; id: string; actorUserId: string }>(sonSocket, SOCKET_EVENTS.BUSINESS_UPDATED);
    await request(app).patch('/api/business').set(bearer(father.accessToken)).send({ city: 'Karachi' }).expect(200);

    const notice = await received;
    expect(notice).toMatchObject({ entity: 'business', id: father.businessId, actorUserId: father.userId });
    await new Promise((r) => setTimeout(r, 100));
    expect(strangerGotIt).toBe(false);
  });

  it('disconnects sockets whose session is revoked', async () => {
    const father = await registerOwner(app);
    const socket = await open(father.accessToken);
    const revoked = nextEvent(socket, SOCKET_EVENTS.SESSION_REVOKED);
    const disconnected = nextEvent(socket, 'disconnect');

    await request(app).post('/api/auth/logout-all').set(bearer(father.accessToken)).expect(200);
    await revoked;
    await disconnected;
    expect(socket.connected).toBe(false);
  });
});
