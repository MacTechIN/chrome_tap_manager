// bridge/mockHost.ts — in-memory native host for tests (and a future dev harness).
// Acts as the transport; the "host side" records what the client sent and can reply.

import { isBridgeMessage, type BridgeMessage } from './protocol';
import type { BridgePort, BridgeTransport } from './transport';

export class MockHost implements BridgeTransport {
  /** When false, every connect() disconnects immediately like a missing host. */
  available = true;
  /** Messages received from the client, in order (across connections). */
  received: BridgeMessage[] = [];
  connections = 0;
  private toClient: ((msg: unknown) => void) | undefined;
  private onClientDisconnect: ((error?: string) => void) | undefined;
  private open = false;

  connect(_hostName: string): BridgePort {
    this.connections++;
    let msgCb: ((msg: unknown) => void) | undefined;
    let discCb: ((error?: string) => void) | undefined;
    this.open = this.available;
    this.toClient = (m) => queueMicrotask(() => msgCb?.(m));
    this.onClientDisconnect = (e) => {
      if (!this.open) return;
      this.open = false;
      queueMicrotask(() => discCb?.(e));
    };
    const port: BridgePort = {
      post: (msg) => {
        if (!this.open) return;
        if (isBridgeMessage(msg)) this.received.push(msg);
      },
      onMessage: (cb) => {
        msgCb = cb;
      },
      onDisconnect: (cb) => {
        discCb = cb;
        if (!this.available) {
          queueMicrotask(() => cb('Specified native messaging host not found.'));
        }
      },
      disconnect: () => {
        this.open = false;
      },
    };
    return port;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Host → client. */
  send(msg: BridgeMessage | Record<string, unknown>): void {
    if (!this.open) throw new Error('mock host: port is closed');
    this.toClient?.(msg);
  }

  /** Host closes the port (e.g. the tray app quit). */
  disconnect(error?: string): void {
    this.onClientDisconnect?.(error);
  }

  ofType<T extends BridgeMessage['type']>(type: T): Extract<BridgeMessage, { type: T }>[] {
    return this.received.filter((m) => m.type === type) as Extract<BridgeMessage, { type: T }>[];
  }

  /** Wait for queued microtasks to settle. */
  static settle(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0));
  }
}
