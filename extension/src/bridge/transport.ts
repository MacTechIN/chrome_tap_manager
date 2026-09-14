// bridge/transport.ts — the tiny port abstraction BridgeClient talks to.
// Real implementation: chrome/nativeTransport.ts (runtime.connectNative).
// Test implementation: bridge/mockHost.ts.

import type { BridgeMessage } from './protocol';

export interface BridgePort {
  post(msg: BridgeMessage): void;
  onMessage(cb: (msg: unknown) => void): void;
  /** `error` is Chrome's lastError text, e.g. "Specified native messaging host not found." */
  onDisconnect(cb: (error?: string) => void): void;
  disconnect(): void;
}

export interface BridgeTransport {
  /** Opens a port. Must not throw for a missing host — report that via onDisconnect. */
  connect(hostName: string): BridgePort;
}
