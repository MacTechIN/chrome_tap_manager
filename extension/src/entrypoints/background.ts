import { browser, defineBackground } from '#imports';
import { createChromeActions } from '../chrome/actions';
import { loadInitialState, subscribeChromeEvents } from '../chrome/events';
import { registerOmnibox } from '../chrome/omnibox';
import { ChromeStorageKV } from '../chrome/storageKv';
import { CommandRunner } from '../core/commandRunner';
import type { LiveEvent, LiveState } from '../core/liveState';
import { LiveTracker } from '../core/liveTracker';
import type { RuntimeRequest, RuntimeResponse } from '../core/messages';
import { Repo } from '../core/repo';
import { SearchIndex } from '../core/search/index';
import { buildSearchDocs } from '../core/searchDocs';
import { TopicError, TopicService } from '../core/topicService';

const SESSION_KEY = 'ctm:session';
const MENU_ROOT = 'ctm-send';
const MENU_NEW = 'ctm-send-new';
const MENU_TOPIC_PREFIX = 'ctm-send-topic:';
const CMD_SEND_LAST = 'send-to-last-topic';

// E03: LiveTracker mirrors open windows/tabs.  E04: TopicService — one window = one Topic.
// E05/E06: SearchIndex + CommandRunner behind runtime messages for the popup.
export default defineBackground(() => {
  const startedAt = Date.now();
  const log = (msg: string, data?: unknown) =>
    data === undefined ? console.log(`[ctm] ${msg}`) : console.log(`[ctm] ${msg}`, data);
  // Last few failures, surfaced in the popup (debug.stats) so field issues are visible.
  const errors: string[] = [];
  const fail = (msg: string, err: unknown) => {
    const text = `${new Date().toLocaleTimeString()} ${msg}: ${
      err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    }`;
    errors.push(text);
    if (errors.length > 5) errors.shift();
    console.error(`[ctm] ${msg}`, err);
  };
  let sessionWasFresh: boolean | undefined;

  const localKv = new ChromeStorageKV('local');
  const sessionKv = new ChromeStorageKV('session');
  const repo = new Repo(localKv);
  const tracker = new LiveTracker({
    kv: sessionKv,
    loadSnapshot: loadInitialState,
    subscribe: subscribeChromeEvents,
    log,
  });

  // ---- event pipeline: tracker → topic service (buffered until the repo is ready) ----
  let service: TopicService | undefined;
  let runner: CommandRunner | undefined;
  const pending: [LiveEvent, LiveState][] = [];
  let chain: Promise<void> = Promise.resolve();
  let indexDirty = true;
  let menuDirty = true;
  const enqueue = (event: LiveEvent, state: LiveState) => {
    chain = chain
      .then(() => service!.apply(event, state))
      .then(() => {
        indexDirty = true;
        if (event.type !== 'tab.activated' && event.type !== 'window.focused') menuDirty = true;
        scheduleMenuRebuild();
      })
      .catch((err) => fail(`topic apply failed (${event.type})`, err));
  };
  tracker.onChange((state, event) => {
    if (service) enqueue(event, state);
    else pending.push([event, state]);
  });

  // Chrome listeners must be registered in the first turn of the SW script.
  const trackerReady = tracker.start().catch((err) => fail('live tracker failed to start', err));

  const ready: Promise<void> = (async () => {
    await repo.init();
    const session = await sessionKv.get<{ id: string; startedAt: number }>(SESSION_KEY);
    const freshSession = session === undefined;
    sessionWasFresh = freshSession;
    if (freshSession) {
      await sessionKv.set(SESSION_KEY, { id: crypto.randomUUID(), startedAt });
    }
    service = new TopicService({ repo, freshSession, log });
    runner = new CommandRunner({
      repo,
      service,
      actions: createChromeActions({ waitForWindow }),
      log,
    });
    for (const [e, s] of pending) enqueue(e, s);
    pending.length = 0;
    await trackerReady;
    await chain;
    log('topic service ready', { freshSession, topics: service.listTopics().length });
  })().catch((err) => fail('background init failed', err));

  /** Waits until the live tracker sees the window and the topic service has processed it. */
  async function waitForWindow(windowId: number): Promise<void> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await chain;
      if (tracker.current.windows[windowId] && service?.topicForWindow(windowId)) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    log('waitForWindow timed out', { windowId });
  }

  // ---- search index (rebuilt lazily after changes) ----
  const index = new SearchIndex();
  const ensureIndex = () => {
    if (!indexDirty) return;
    const t0 = performance.now();
    index.replaceAll(buildSearchDocs(repo.snapshot()));
    indexDirty = false;
    log('search index rebuilt', { docs: index.size, ms: Math.round(performance.now() - t0) });
  };

  // ---- context menu: "주제로 보내기 ▸ [topics]" / "새 주제로" ----
  let menuTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleMenuRebuild() {
    if (!menuDirty || menuTimer !== undefined) return;
    menuTimer = setTimeout(() => {
      menuTimer = undefined;
      rebuildMenu().catch((err) => log('menu rebuild failed', err));
    }, 500);
  }
  async function rebuildMenu() {
    if (!service) return;
    menuDirty = false;
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: MENU_ROOT,
      title: '주제로 보내기',
      contexts: ['page', 'action'],
    });
    browser.contextMenus.create({
      id: MENU_NEW,
      parentId: MENU_ROOT,
      title: '새 주제로 (새 창)',
      contexts: ['page', 'action'],
    });
    browser.contextMenus.create({
      id: `${MENU_ROOT}-sep`,
      parentId: MENU_ROOT,
      type: 'separator',
      contexts: ['page', 'action'],
    });
    for (const t of service.listTopics().slice(0, 20)) {
      browser.contextMenus.create({
        id: `${MENU_TOPIC_PREFIX}${t.id}`,
        parentId: MENU_ROOT,
        title: `${t.name}${t.status === 'saved' ? ' (저장됨)' : ''}`,
        contexts: ['page', 'action'],
      });
    }
  }
  browser.contextMenus.onClicked.addListener((info, tab) => {
    const id = String(info.menuItemId);
    const tabId = tab?.id;
    if (tabId === undefined) return;
    ready
      .then(async () => {
        if (id === MENU_NEW) await runner!.newTopic({ chromeTabIds: [tabId] });
        else if (id.startsWith(MENU_TOPIC_PREFIX)) {
          await runner!.move({
            topicId: id.slice(MENU_TOPIC_PREFIX.length),
            chromeTabIds: [tabId],
          });
        }
      })
      .catch((err) => log('context menu action failed', err));
  });

  // ---- keyboard command: send active tab to the last used topic ----
  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== CMD_SEND_LAST) return;
    ready
      .then(async () => {
        const tabId =
          tab?.id ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
        const topicId = runner!.lastMoveTopicId;
        if (tabId === undefined || !topicId || !repo.getTopic(topicId)) return;
        await runner!.move({ topicId, chromeTabIds: [tabId] });
      })
      .catch((err) => log('send-to-last-topic failed', err));
  });

  browser.runtime.onInstalled.addListener(() => {
    menuDirty = true;
    ready.then(rebuildMenu).catch((err) => log('menu init failed', err));
  });

  // ---- omnibox: "t" + space in the address bar ----
  // Optional integration: never let it prevent the message listener below from registering.
  try {
    registerOmnibox({
      log,
      search: async (text, limit) => {
        await ready;
        await chain;
        ensureIndex();
        const [current] = await browser.tabs.query({ active: true, currentWindow: true });
        return index.search({
          text,
          scope: { kind: 'open' },
          currentWindowId: current?.windowId,
          limit,
        });
      },
      activate: async (target) => {
        await ready;
        await runner!.focus(target);
      },
    });
  } catch (err) {
    log('omnibox registration failed', err);
  }

  // ---- runtime messages (popup / side panel) ----
  const toErrorResponse = (err: unknown): RuntimeResponse =>
    err instanceof TopicError
      ? { type: 'error', code: err.code, message: err.message }
      : { type: 'error', code: 'internal', message: String(err) };

  browser.runtime.onMessage.addListener(
    (msg: RuntimeRequest, _sender, sendResponse: (r: RuntimeResponse) => void) => {
      const handle = async (): Promise<RuntimeResponse> => {
        await ready;
        await chain;
        const svc = service!;
        const run = runner!;
        switch (msg?.type) {
          case 'live.get':
            return { type: 'live.state', state: tracker.current, startedAt };
          case 'debug.stats': {
            const snap = repo.snapshot();
            const bytesInUse = await browser.storage.local
              .getBytesInUse(null)
              .catch(() => undefined);
            return {
              bytesInUse,
              type: 'debug.stats',
              topics: snap.topics.length,
              openTopics: snap.topics.filter((t) => t.status === 'open').length,
              tabs: snap.tabs.length,
              openTabs: snap.tabs.filter((t) => t.isOpen).length,
              indexSize: index.size,
              indexDirty,
              liveWindows: Object.keys(tracker.current.windows).length,
              liveTabs: Object.keys(tracker.current.tabs).length,
              seq: tracker.current.seq,
              freshSession: sessionWasFresh,
              startedAt,
              errors: [...errors],
            };
          }
          case 'live.resync':
            await tracker.resync();
            await chain;
            return { type: 'live.state', state: tracker.current, startedAt };
          case 'topics.list':
            return { type: 'topics.list', topics: svc.listTopics() };
          case 'topic.rename':
            await svc.rename(msg.topicId, msg.name);
            return { type: 'ok' };
          case 'topic.deleteSaved':
            await svc.deleteSaved(msg.topicId);
            return { type: 'ok' };
          case 'topic.setColor':
            return { type: 'topic', topic: await svc.setColor(msg.topicId, msg.color) };
          case 'sidepanel.tree':
            return { type: 'sidepanel.tree', topics: svc.tree() };
          case 'search': {
            ensureIndex();
            const hits = index.search({
              text: msg.text,
              scope: msg.scope,
              currentWindowId: msg.currentWindowId,
              limit: msg.limit,
            });
            return { type: 'search', hits };
          }
          case 'cmd.focus':
            return { type: 'focus', result: await run.focus(msg.target, msg.mode) };
          case 'cmd.move':
            return {
              type: 'move',
              result: await run.move({
                topicId: msg.topicId,
                chromeTabIds: msg.chromeTabIds,
                switchTo: msg.switchTo,
              }),
            };
          case 'cmd.new':
            return { type: 'topic', topic: await run.newTopic(msg) };
          case 'cmd.rename':
            return { type: 'topic', topic: await run.rename(msg) };
          case 'cmd.merge':
            return { type: 'move', result: await run.merge(msg) };
          default:
            return { type: 'error', code: 'internal', message: 'unknown message' };
        }
      };
      handle().then(sendResponse, (err) => sendResponse(toErrorResponse(err)));
      return true;
    },
  );

  log('background started', { id: browser.runtime.id });
});
