import { browser, defineBackground } from '#imports';
import { BridgeClient, type SnapshotData } from '../bridge/client';
import type { ProtoTab, ProtoTopic, ProtoWindow } from '../bridge/protocol';
import { createChromeActions } from '../chrome/actions';
import { loadInitialState, subscribeChromeEvents } from '../chrome/events';
import { nativeTransport } from '../chrome/nativeTransport';
import { registerOmnibox } from '../chrome/omnibox';
import { ChromeStorageKV } from '../chrome/storageKv';
import { AutoMover } from '../core/autoMover';
import { CommandRunner } from '../core/commandRunner';
import { applyImport, buildExport, parseExport } from '../core/exportImport';
import type { LiveEvent, LiveState } from '../core/liveState';
import { LiveTracker } from '../core/liveTracker';
import type { RuntimeRequest, RuntimeResponse } from '../core/messages';
import { Repo } from '../core/repo';
import { makeRule, ruleKey } from '../core/rules';
import { suggestRules } from '../core/ruleSuggest';
import { SettingsStore } from '../core/settings';
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
  const settings = new SettingsStore(localKv);
  const tracker = new LiveTracker({
    kv: sessionKv,
    loadSnapshot: loadInitialState,
    subscribe: subscribeChromeEvents,
    log,
  });

  // ---- event pipeline: tracker → topic service (buffered until the repo is ready) ----
  let service: TopicService | undefined;
  let runner: CommandRunner | undefined;
  let mover: AutoMover | undefined;
  let bridge: BridgeClient | undefined;
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
        bridge?.onLiveEvent(event as { type: string } & Record<string, unknown>, state.seq);
        if (event.type !== 'tab.activated' && event.type !== 'window.focused') {
          bridge?.topicsChanged();
        }
        return routeByRules(event, state);
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
    await settings.load();
    const session = await sessionKv.get<{ id: string; startedAt: number }>(SESSION_KEY);
    const freshSession = session === undefined;
    sessionWasFresh = freshSession;
    if (freshSession) {
      await sessionKv.set(SESSION_KEY, { id: crypto.randomUUID(), startedAt });
    }
    service = new TopicService({ repo, freshSession, log });
    mover = new AutoMover({
      repo,
      settings,
      actions: {
        moveTabs: (ids, windowId) =>
          browser.tabs.move(ids, { windowId, index: -1 }).then(() => undefined),
      },
      log,
    });
    runner = new CommandRunner({
      repo,
      service,
      actions: createChromeActions({ waitForWindow }),
      log,
      onUserMoved: (ids) => mover?.markUserMoved(ids),
    });
    for (const [e, s] of pending) enqueue(e, s);
    pending.length = 0;
    await trackerReady;
    await chain;
    log('topic service ready', { freshSession, topics: service.listTopics().length });
    bridge = new BridgeClient({
      transport: nativeTransport,
      handlers: bridgeHandlers(),
      extVersion: browser.runtime.getManifest().version,
      log,
    });
    bridge.start();
  })().catch((err) => fail('background init failed', err));

  /** F-10: when a tab's URL settles, let rules route it (user moves always win). */
  async function routeByRules(event: LiveEvent, state: LiveState): Promise<void> {
    if (!mover) return;
    if (event.type === 'tab.removed') {
      mover.forget(event.tabId);
      return;
    }
    let chromeTabId: number | undefined;
    if (event.type === 'tab.created') chromeTabId = event.tab.id;
    else if (
      event.type === 'tab.updated' &&
      (event.changes.url !== undefined || event.changes.status === 'complete')
    ) {
      chromeTabId = event.tabId;
    }
    if (chromeTabId === undefined) return;
    const live = state.tabs[chromeTabId];
    if (!live || !live.url) return;
    try {
      await mover.onTabUrl({ chromeTabId, url: live.url, windowId: live.windowId });
    } catch (err) {
      fail('rule routing failed', err);
    }
  }

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

  // ---- bridge (E10): what the desktop app can ask of us ----
  function protoTopics(): ProtoTopic[] {
    return service!
      .listTopics()
      .filter((t) => t.windowId !== undefined)
      .map((t) => ({
        id: t.id,
        name: t.name,
        isNamed: t.isNamed,
        color: t.color,
        windowId: t.windowId!,
        tabCount: t.tabCount,
        lastActiveAt: t.lastActiveAt,
      }));
  }
  function activeTitle(windowId: number): string | undefined {
    const w = tracker.current.windows[windowId];
    const active = w?.tabIds.map((id) => tracker.current.tabs[id]).find((t) => t?.active);
    return active?.title;
  }
  function bridgeHandlers() {
    return {
      seq: () => tracker.current.seq,
      topics: protoTopics,
      snapshot: (): SnapshotData => {
        const live = tracker.current;
        const topicByWindow = new Map(protoTopics().map((t) => [t.windowId, t.id] as const));
        const windows: ProtoWindow[] = Object.values(live.windows)
          .filter((w) => topicByWindow.has(w.id))
          .map((w) => ({
            id: w.id,
            focused: w.focused,
            topicId: topicByWindow.get(w.id)!,
            title: activeTitle(w.id),
          }));
        const tabs: ProtoTab[] = Object.values(live.tabs)
          .filter((t) => topicByWindow.has(t.windowId))
          .map((t) => ({
            id: t.id,
            rowId: repo.findTabByChromeId(t.id)?.id,
            windowId: t.windowId,
            topicId: topicByWindow.get(t.windowId)!,
            index: t.index,
            url: t.url,
            title: t.title,
            favicon: t.favicon,
            active: t.active,
            groupId: t.groupId,
            lastActiveAt: t.lastAccessed,
          }));
        return {
          seq: live.seq,
          topics: protoTopics(),
          windows,
          tabs,
          groups: Object.values(live.groups ?? {}),
        };
      },
      focus: async (windowId: number, tabId?: number) => {
        await ready;
        if (tabId !== undefined) {
          await runner!.focus({ kind: 'chromeTab', chromeTabId: tabId, windowId }, 'tab');
        } else {
          await browser.windows.update(windowId, { focused: true, drawAttention: true });
        }
        return { windowId, windowTitle: activeTitle(windowId) };
      },
      move: async (tabIds: number[], topicId: string, switchTo?: boolean) => {
        await ready;
        await runner!.move({ topicId, chromeTabIds: tabIds, switchTo });
      },
      newTopic: async (tabIds: number[], name?: string) => {
        await ready;
        await runner!.newTopic({ chromeTabIds: tabIds, name });
      },
      rename: async (topicId: string, name: string) => {
        await ready;
        await service!.rename(topicId, name);
      },
      close: async (topicId: string) => {
        await ready;
        const t = repo.getTopic(topicId);
        if (!t || t.windowId === undefined) throw new Error('열려 있지 않은 주제입니다');
        await browser.windows.remove(t.windowId);
      },
    };
  }

  function currentSuggestions() {
    return suggestRules({
      moveLog: repo.listMoveLog(),
      rules: repo.listRules(),
      dismissed: new Set(settings.get().dismissedSuggestions),
      openTopicNames: repo
        .listTopics()
        .filter((t) => t.status === 'open')
        .map((t) => t.name),
      now: repo.now(),
    });
  }
  void ruleKey; // (kept for parity with core; suggestions carry their own key)

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
          case 'cmd.close':
            return { type: 'close', result: await run.close(msg) };
          case 'data.export': {
            const file = buildExport(repo.snapshot(), settings.get(), repo.now());
            const stamp = file.exportedAt.slice(0, 19).replace(/[:T]/g, '-');
            return {
              type: 'data.export',
              text: JSON.stringify(file, null, 2),
              filename: `chrome-tap-manager-${stamp}.json`,
            };
          }
          case 'data.import': {
            const file = parseExport(msg.text);
            const result = await applyImport(file, repo, settings);
            indexDirty = true;
            return { type: 'data.import', result };
          }
          case 'data.reset': {
            await repo.clear();
            await settings.update({
              ...settings.get(),
              rulesEnabled: true,
              dismissedSuggestions: [],
            });
            await tracker.resync();
            await chain;
            indexDirty = true;
            menuDirty = true;
            scheduleMenuRebuild();
            return { type: 'ok' };
          }
          case 'rules.list':
            return { type: 'rules.list', rules: repo.listRules() };
          case 'rules.put': {
            const existing = msg.id ? repo.listRules().find((r) => r.id === msg.id) : undefined;
            const draft = makeRule(
              { kind: msg.kind, pattern: msg.pattern, topicName: msg.topicName, source: 'manual' },
              { newId: () => existing?.id ?? repo.newId(), now: () => repo.now() },
            );
            if (!draft.pattern || !draft.topicName) {
              return { type: 'error', code: 'internal', message: '패턴과 주제 이름이 필요합니다' };
            }
            await repo.putRule(existing ? { ...existing, ...draft, id: existing.id } : draft);
            return { type: 'rules.list', rules: repo.listRules() };
          }
          case 'rules.toggle': {
            const r = repo.listRules().find((x) => x.id === msg.id);
            if (r)
              await repo.putRule({
                ...r,
                enabled: msg.enabled,
                undoCount: msg.enabled ? 0 : r.undoCount,
              });
            return { type: 'rules.list', rules: repo.listRules() };
          }
          case 'rules.delete':
            await repo.deleteRule(msg.id);
            return { type: 'rules.list', rules: repo.listRules() };
          case 'rules.suggestions':
            return { type: 'rules.suggestions', suggestions: currentSuggestions() };
          case 'rules.accept': {
            const sg = currentSuggestions().find((x) => x.key === msg.key);
            if (!sg)
              return {
                type: 'error',
                code: 'internal',
                message: '제안이 더 이상 유효하지 않습니다',
              };
            await repo.putRule(
              makeRule(
                { kind: sg.kind, pattern: sg.pattern, topicName: sg.topicName, source: 'learned' },
                { newId: () => repo.newId(), now: () => repo.now() },
              ),
            );
            return { type: 'rules.list', rules: repo.listRules() };
          }
          case 'rules.dismiss':
            await settings.dismissSuggestion(msg.key);
            return { type: 'settings', settings: settings.get() };
          case 'settings.get':
            return { type: 'settings', settings: settings.get() };
          case 'settings.update':
            return { type: 'settings', settings: await settings.update(msg.patch) };
          case 'bridge.status':
            return {
              type: 'bridge.status',
              status: bridge?.status() ?? { state: 'stopped', hostName: '', attempts: 0 },
            };
          case 'bridge.reconnect':
            bridge?.stop();
            bridge?.start();
            return {
              type: 'bridge.status',
              status: bridge?.status() ?? { state: 'stopped', hostName: '', attempts: 0 },
            };
          case 'automove.recent':
            return { type: 'automove.recent', moves: mover ? mover.recent(msg.withinMs) : [] };
          case 'automove.undo': {
            if (!mover) return { type: 'automove.undo', result: { undone: false } };
            const result = await mover.undo(
              msg.id,
              (wid) => tracker.current.windows[wid] !== undefined,
            );
            return { type: 'automove.undo', result };
          }
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
