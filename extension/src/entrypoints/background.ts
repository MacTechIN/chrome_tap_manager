import { browser, defineBackground } from '#imports';
import { loadInitialState, subscribeChromeEvents } from '../chrome/events';
import { ChromeStorageKV } from '../chrome/storageKv';
import { LiveTracker } from '../core/liveTracker';
import type { RuntimeRequest, RuntimeResponse } from '../core/messages';

// E03: keep an in-memory mirror of open windows/tabs, persisted to storage.session
// so `seq` survives service-worker restarts. E04 builds the Topic model on top.
export default defineBackground(() => {
  const startedAt = Date.now();
  const log = (msg: string, data?: unknown) =>
    data === undefined ? console.log(`[ctm] ${msg}`) : console.log(`[ctm] ${msg}`, data);

  const tracker = new LiveTracker({
    kv: new ChromeStorageKV('session'),
    loadSnapshot: loadInitialState,
    subscribe: subscribeChromeEvents,
    log,
  });

  // Listeners are registered synchronously inside start(); the async part follows.
  const ready = tracker.start().catch((err) => log('live tracker failed to start', err));

  browser.runtime.onMessage.addListener(
    (msg: RuntimeRequest, _sender, sendResponse: (r: RuntimeResponse) => void) => {
      if (msg?.type === 'live.get') {
        ready.then(() => sendResponse({ type: 'live.state', state: tracker.current, startedAt }));
        return true;
      }
      if (msg?.type === 'live.resync') {
        ready
          .then(() => tracker.resync())
          .then(() => sendResponse({ type: 'live.state', state: tracker.current, startedAt }));
        return true;
      }
      return false;
    },
  );

  log('background started', { id: browser.runtime.id });
});
