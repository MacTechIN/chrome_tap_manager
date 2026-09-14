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
    const port = api.connectNative(hostName);
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
