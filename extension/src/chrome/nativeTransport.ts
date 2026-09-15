// chrome/nativeTransport.ts — BridgeTransport over chrome.runtime.connectNative.

import { browser } from '#imports';
import type { BridgeMessage } from '../bridge/protocol';
import type { BridgePort, BridgeTransport } from '../bridge/transport';

export const nativeTransport: BridgeTransport = {
  connect(hostName: string): BridgePort {
    const api = browser.runtime as unknown as {
      connectNative?: (name: string) => chrome.runtime.Port;
      lastError?: { message?: string };
    };
    if (typeof api.connectNative !== 'function') {
      // No "nativeMessaging" permission (or a fake): behave like a missing host.
      return {
        post() {},
        onMessage() {},
        onDisconnect(cb) {
          queueMicrotask(() => cb('nativeMessaging API unavailable'));
        },
        disconnect() {},
      };
    }
    let port: chrome.runtime.Port;
    try {
      port = api.connectNative(hostName);
    } catch (err) {
      // Optional permission not granted yet (E12): same as a missing host.
      const reason = err instanceof Error ? err.message : String(err);
      return {
        post() {},
        onMessage() {},
        onDisconnect(cb) {
          queueMicrotask(() => cb(reason));
        },
        disconnect() {},
      };
    }
    return {
      post(msg: BridgeMessage) {
        port.postMessage(msg);
      },
      onMessage(cb) {
        port.onMessage.addListener((m) => cb(m));
      },
      onDisconnect(cb) {
        port.onDisconnect.addListener(() => cb(browser.runtime.lastError?.message));
      },
      disconnect() {
        try {
          port.disconnect();
        } catch {
          /* already closed */
        }
      },
    };
  },
};
