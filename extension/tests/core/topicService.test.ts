import { beforeEach, describe, expect, it } from 'vitest';
import { fingerprint } from '../../src/core/fingerprint';
import { checkInvariants } from '../../src/core/invariants';
import {
  emptyLiveState,
  type LiveEvent,
  type LiveState,
  type LiveTab,
  reduce,
} from '../../src/core/liveState';
import { MemoryKV, Repo } from '../../src/core/repo';
import { TopicError, TopicService } from '../../src/core/topicService';

const T0 = 1_700_000_000_000;

function tab(id: number, windowId: number, index: number, over: Partial<LiveTab> = {}): LiveTab {
  return {
    id,
    windowId,
    index,
    url: `https://site${windowId}.com/p/${id}`,
    title: `Tab ${id}`,
    active: index === 0,
    pinned: false,
    ...over,
  };
}

class Harness {
  kv = new MemoryKV();
  repo!: Repo;
  service!: TopicService;
  state: LiveState = emptyLiveState();
  now = T0;
  private seq = 0;

  async init(opts: { freshSession?: boolean; seed?: () => Promise<void> } = {}) {
    this.repo = new Repo(this.kv, { now: () => this.now, newId: () => `id-${++this.seq}` });
    await this.repo.init();
    if (opts.seed) await opts.seed();
    this.service = new TopicService({ repo: this.repo, freshSession: opts.freshSession ?? false });
    return this;
  }

  /** Reduce + apply, then assert invariants. */
  async emit(...events: LiveEvent[]) {
    for (const e of events) {
      this.now += 1000;
      this.state = reduce(this.state, e);
      await this.service.apply(e, this.state);
      const v = checkInvariants(this.repo.snapshot());
      if (v.length) throw new Error(`after ${e.type}: ${v.map((x) => x.code).join(',')}`);
    }
  }

  /** Chrome's sequence when a window closes: tab.removed(isWindowClosing) per tab, then window.removed. */
  closeWindowEvents(windowId: number): LiveEvent[] {
    const ids = this.state.windows[windowId]?.tabIds ?? [];
    return [
      ...ids.map((tabId): LiveEvent => ({
        type: 'tab.removed',
        tabId,
        windowId,
        isWindowClosing: true,
      })),
      { type: 'window.removed', windowId },
    ];
  }

  topics() {
    return this.repo.listTopics();
  }
  topicOf(windowId: number) {
    return this.repo.findTopicByWindow(windowId);
  }
}

const INIT: LiveEvent = {
  type: 'init',
  windows: [
    { id: 10, focused: true, tabs: [tab(1, 10, 0), tab(2, 10, 1)] },
    { id: 20, focused: false, tabs: [tab(3, 20, 0)] },
  ],
};

describe('TopicService: init / reconcile', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await new Harness().init();
  });

  it('creates one open topic per window with auto names and tab rows', async () => {
    await h.emit(INIT);
    const topics = h.topics();
    expect(topics).toHaveLength(2);
    expect(h.topicOf(10)).toMatchObject({ status: 'open', isNamed: false, name: 'site10.com' });
    expect(h.topicOf(20)).toMatchObject({ status: 'open', isNamed: false, name: 'site20.com' });

    const rows = h.repo.listTabs({ topicId: h.topicOf(10)!.id });
    expect(rows.map((r) => [r.chromeTabId, r.index])).toEqual([
      [1, 0],
      [2, 1],
    ]);
    expect(rows[0]!.fingerprint).toBe(fingerprint('https://site10.com/p/1', 'Tab 1'));
    expect(rows[0]!.isOpen).toBe(true);
  });

  it('same session: re-init keeps existing topics, drops rows of tabs closed while asleep', async () => {
    await h.emit(INIT);
    const before = h.topicOf(10)!.id;
    await h.service.rename(before, 'Dev');

    // SW restarts: window 10 lost tab 2, window 20 is gone, window 30 is new.
    h.state = emptyLiveState(h.state.seq);
    await h.emit({
      type: 'init',
      windows: [
        { id: 10, focused: true, tabs: [tab(1, 10, 0)] },
        { id: 30, focused: false, tabs: [tab(9, 30, 0)] },
      ],
    });

    expect(h.topicOf(10)).toMatchObject({ id: before, name: 'Dev', status: 'open' });
    expect(h.repo.listTabs({ topicId: before }).map((r) => r.chromeTabId)).toEqual([1]);
    expect(h.topicOf(30)).toMatchObject({ status: 'open', name: 'site30.com' });
    // Window 20 is gone → its topic is gone (nothing is kept for closed windows).
    expect(h.topics().filter((t) => t.status === 'saved')).toEqual([]);
    expect(
      h
        .topics()
        .map((t) => t.windowId)
        .sort(),
    ).toEqual([10, 30]);
  });

  it('fresh session: a stale open topic with no matching window is dropped; live windows get new topics', async () => {
    // Previous browser session left an open topic on windowId 10 with a tab.
    const fresh = new Harness();
    h = fresh;
    await fresh.init({
      freshSession: true,
      seed: async () => {
        await fresh.repo.putTopic({
          id: 'old',
          name: 'Old work',
          isNamed: true,
          status: 'open',
          windowId: 10,
          browser: 'chrome',
          lastActiveAt: 1,
          createdAt: 1,
          updatedAt: 1,
        });
        await fresh.repo.putTab({
          id: 'oldtab',
          topicId: 'old',
          fingerprint: 'f',
          url: 'https://old.com/',
          title: 'Old',
          chromeTabId: 77,
          index: 0,
          isOpen: true,
          lastActiveAt: 1,
          updatedAt: 1,
        });
      },
    });

    await h.emit(INIT); // new session also has a window with id 10, but different tabs
    expect(h.repo.getTopic('old')).toBeUndefined();
    expect(h.repo.getTab('oldtab')).toBeUndefined();
    expect(h.topicOf(10)!.id).not.toBe('old');
    expect(h.topics()).toHaveLength(2);
    expect(h.topics().every((t) => t.status === 'open')).toBe(true);
  });
});

describe('TopicService: window lifecycle', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await new Harness().init();
    await h.emit(INIT);
  });

  it('window.created → new open topic with placeholder; first tab defines the name', async () => {
    await h.emit({ type: 'window.created', window: { id: 30, focused: false } });
    expect(h.topicOf(30)).toMatchObject({ status: 'open', isNamed: false, name: '새 주제 1' });

    await h.emit({ type: 'tab.created', tab: tab(9, 30, 0, { url: 'https://docs.rs/x' }) });
    expect(h.topicOf(30)!.name).toBe('docs.rs');
    expect(h.repo.listTabs({ topicId: h.topicOf(30)!.id })).toHaveLength(1);
  });

  it('name does not flicker while tabs are added; refreshes when focus leaves the window', async () => {
    await h.emit(
      { type: 'window.created', window: { id: 30, focused: true } },
      { type: 'tab.created', tab: tab(9, 30, 0, { url: 'https://a.com/' }) },
      { type: 'tab.created', tab: tab(8, 30, 1, { url: 'https://b.com/1' }) },
      { type: 'tab.created', tab: tab(7, 30, 2, { url: 'https://b.com/2' }) },
    );
    expect(h.topicOf(30)!.name).toBe('a.com'); // still the first tab's site

    await h.emit({ type: 'window.focused', windowId: 10 });
    expect(h.topicOf(30)!.name).toBe('b.com'); // recomputed: most common host
  });

  it('closing an unnamed window drops its topic and tabs (nothing lingers)', async () => {
    const id = h.topicOf(10)!.id;
    await h.emit(...h.closeWindowEvents(10));
    expect(h.repo.getTopic(id)).toBeUndefined();
    expect(h.repo.listTabs({ topicId: id })).toEqual([]);
  });

  it('closing a named window also drops the topic (topic lifetime = window lifetime)', async () => {
    const id = h.topicOf(10)!.id;
    await h.service.rename(id, 'Keep');
    await h.emit(...h.closeWindowEvents(10));
    expect(h.repo.getTopic(id)).toBeUndefined();
    expect(h.repo.listTabs({ topicId: id })).toEqual([]);
  });

  it('focus changes update lastActiveAt of the focused topic', async () => {
    const before = h.topicOf(20)!.lastActiveAt;
    await h.emit({ type: 'window.focused', windowId: 20 });
    expect(h.topicOf(20)!.lastActiveAt).toBeGreaterThan(before);
  });
});

describe('TopicService: tab lifecycle', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await new Harness().init();
    await h.emit(INIT);
  });

  it('tab.updated refreshes url/title/fingerprint; unchanged rows are not rewritten', async () => {
    const row = h.repo.findTabByChromeId(1)!;
    await h.emit({
      type: 'tab.updated',
      tabId: 1,
      changes: { url: 'https://site10.com/other', title: 'Other' },
    });
    const after = h.repo.findTabByChromeId(1)!;
    expect(after.id).toBe(row.id);
    expect(after.url).toBe('https://site10.com/other');
    expect(after.fingerprint).toBe(fingerprint('https://site10.com/other', 'Other'));
    expect(after.fingerprint).not.toBe(row.fingerprint);

    const stamp = after.updatedAt;
    await h.emit({ type: 'tab.updated', tabId: 1, changes: { status: 'complete' } });
    expect(h.repo.findTabByChromeId(1)!.updatedAt).toBe(stamp);
  });

  it('tab.removed (user closed) deletes the row', async () => {
    await h.emit({ type: 'tab.removed', tabId: 2, windowId: 10, isWindowClosing: false });
    expect(h.repo.findTabByChromeId(2)).toBeUndefined();
    expect(h.repo.listTabs({ topicId: h.topicOf(10)!.id })).toHaveLength(1);
  });

  it('tab.moved re-syncs indexes', async () => {
    await h.emit({ type: 'tab.moved', tabId: 1, windowId: 10, fromIndex: 0, toIndex: 1 });
    expect(h.repo.findTabByChromeId(1)!.index).toBe(1);
    expect(h.repo.findTabByChromeId(2)!.index).toBe(0);
  });

  it('dragging a tab to another window re-parents the row; emptied unnamed window disappears', async () => {
    const t10 = h.topicOf(10)!.id;
    const t20 = h.topicOf(20)!.id;
    await h.emit(
      { type: 'tab.detached', tabId: 3, oldWindowId: 20, oldPosition: 0 },
      { type: 'tab.attached', tabId: 3, newWindowId: 10, newPosition: 2 },
      { type: 'window.removed', windowId: 20 },
    );
    expect(h.repo.findTabByChromeId(3)).toMatchObject({ topicId: t10, index: 2 });
    expect(h.repo.listTabs({ topicId: t10 })).toHaveLength(3);
    expect(h.repo.getTopic(t20)).toBeUndefined(); // unnamed + no tabs left
  });

  it('dragging a tab out into a new window creates a topic named after that tab', async () => {
    await h.emit(
      { type: 'tab.detached', tabId: 2, oldWindowId: 10, oldPosition: 1 },
      { type: 'window.created', window: { id: 30, focused: true } },
      { type: 'tab.attached', tabId: 2, newWindowId: 30, newPosition: 0 },
    );
    expect(h.topicOf(30)).toMatchObject({ name: 'site10.com', isNamed: false });
    expect(h.repo.findTabByChromeId(2)!.topicId).toBe(h.topicOf(30)!.id);
    expect(h.repo.listTabs({ topicId: h.topicOf(10)!.id })).toHaveLength(1);
  });

  it('tab.activated bumps lastActiveAt of tab and topic', async () => {
    const tabBefore = h.repo.findTabByChromeId(2)!.lastActiveAt;
    await h.emit({ type: 'tab.activated', tabId: 2, windowId: 10 });
    expect(h.repo.findTabByChromeId(2)!.lastActiveAt).toBeGreaterThan(tabBefore);
  });

  it('self-heals a missing row on tab.updated', async () => {
    const row = h.repo.findTabByChromeId(1)!;
    await h.repo.deleteTab(row.id);
    await h.emit({ type: 'tab.updated', tabId: 1, changes: { title: 'Back' } });
    expect(h.repo.findTabByChromeId(1)).toMatchObject({ title: 'Back' });
  });
});

describe('TopicService: rename / deleteSaved / listTopics', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await new Harness().init();
    await h.emit(INIT);
  });

  it('rename trims, sets isNamed and stops auto-naming', async () => {
    const id = h.topicOf(10)!.id;
    const t = await h.service.rename(id, '  프로젝트  A ');
    expect(t).toMatchObject({ name: '프로젝트 A', isNamed: true });

    await h.emit(
      { type: 'tab.created', tab: tab(5, 10, 2, { url: 'https://zzz.com/' }) },
      { type: 'window.focused', windowId: 20 },
    );
    expect(h.topicOf(10)!.name).toBe('프로젝트 A');
  });

  it('rename validation: empty, too long, duplicate (case-insensitive, named only)', async () => {
    const a = h.topicOf(10)!.id;
    const b = h.topicOf(20)!.id;
    await expect(h.service.rename(a, '   ')).rejects.toMatchObject({ code: 'name.empty' });
    await expect(h.service.rename(a, 'x'.repeat(51))).rejects.toMatchObject({
      code: 'name.tooLong',
    });
    await h.service.rename(a, 'Dev');
    await expect(h.service.rename(b, ' dev ')).rejects.toMatchObject({ code: 'name.duplicate' });
    // renaming to a name equal to an *unnamed* topic's auto name is fine
    await expect(h.service.rename(b, 'site10.com')).resolves.toMatchObject({ isNamed: true });
    await expect(h.service.rename('nope', 'x')).rejects.toBeInstanceOf(TopicError);
  });

  it('deleteSaved refuses open topics (there are no saved topics any more)', async () => {
    const id = h.topicOf(10)!.id;
    await expect(h.service.deleteSaved(id)).rejects.toMatchObject({ code: 'topic.notSaved' });
    await expect(h.service.deleteSaved('nope')).rejects.toMatchObject({ code: 'topic.notFound' });
  });

  it('listTopics: most recently active first, with tab counts; closed windows are absent', async () => {
    await h.emit({ type: 'window.focused', windowId: 20 });
    await h.emit(...h.closeWindowEvents(10));
    const list = h.service.listTopics();
    expect(list.map((t) => [t.status, t.name, t.tabCount])).toEqual([['open', 'site20.com', 1]]);
  });
});

describe('TopicService: randomized window/tab churn keeps invariants', () => {
  it('200 mixed events over several windows', async () => {
    const h = await new Harness().init();
    await h.emit({ type: 'init', windows: [{ id: 1, focused: true, tabs: [tab(100, 1, 0)] }] });

    let rng = 42;
    const rand = (n: number) => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng % n;
    };
    let nextWin = 2;
    let nextTab = 101;

    for (let i = 0; i < 200; i++) {
      const wins = Object.keys(h.state.windows).map(Number);
      const op = rand(10);
      if (op === 0 || wins.length === 0) {
        const id = nextWin++;
        await h.emit(
          { type: 'window.created', window: { id, focused: true } },
          { type: 'tab.created', tab: tab(nextTab++, id, 0) },
        );
        continue;
      }
      const w = wins[rand(wins.length)]!;
      const tabs = h.state.windows[w]!.tabIds;
      if (op <= 3) {
        await h.emit({ type: 'tab.created', tab: tab(nextTab++, w, rand(tabs.length + 1)) });
      } else if (op <= 5 && tabs.length > 0) {
        const t = tabs[rand(tabs.length)]!;
        await h.emit({ type: 'tab.removed', tabId: t, windowId: w, isWindowClosing: false });
      } else if (op === 6 && tabs.length > 1) {
        const t = tabs[rand(tabs.length)]!;
        await h.emit({
          type: 'tab.moved',
          tabId: t,
          windowId: w,
          fromIndex: h.state.tabs[t]!.index,
          toIndex: rand(tabs.length),
        });
      } else if (op === 7 && wins.length > 1 && tabs.length > 0) {
        const t = tabs[rand(tabs.length)]!;
        const target = wins.filter((x) => x !== w)[rand(wins.length - 1)]!;
        await h.emit(
          { type: 'tab.detached', tabId: t, oldWindowId: w, oldPosition: h.state.tabs[t]!.index },
          {
            type: 'tab.attached',
            tabId: t,
            newWindowId: target,
            newPosition: rand(h.state.windows[target]!.tabIds.length + 1),
          },
        );
        if (h.state.windows[w]!.tabIds.length === 0) {
          await h.emit({ type: 'window.removed', windowId: w });
        }
      } else if (op === 8) {
        await h.emit(...h.closeWindowEvents(w));
      } else {
        await h.emit({ type: 'window.focused', windowId: w });
      }
    }

    // Every live window has exactly one open topic and matching open tab rows.
    for (const w of Object.values(h.state.windows)) {
      const topic = h.topicOf(w.id)!;
      expect(topic.status).toBe('open');
      const rows = h.repo.listTabs({ topicId: topic.id, isOpen: true });
      expect(rows.map((r) => r.chromeTabId).sort()).toEqual([...w.tabIds].sort());
    }
    expect(h.repo.listTabs({ isOpen: true })).toHaveLength(Object.keys(h.state.tabs).length);
  });
});
