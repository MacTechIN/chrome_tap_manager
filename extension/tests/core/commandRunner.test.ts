import { beforeEach, describe, expect, it } from 'vitest';
import { type ChromeActions, CommandRunner } from '../../src/core/commandRunner';
import { checkInvariants } from '../../src/core/invariants';
import {
  emptyLiveState,
  type LiveEvent,
  type LiveState,
  type LiveTab,
  reduce,
} from '../../src/core/liveState';
import { MemoryKV, Repo } from '../../src/core/repo';
import { TopicService } from '../../src/core/topicService';

const T0 = 1_700_000_000_000;

/**
 * A tiny "Chrome": ChromeActions that mutate a LiveState and push the resulting
 * events through the TopicService, the way the real pipeline does.
 */
class World {
  kv = new MemoryKV();
  repo = new Repo(this.kv, { now: () => this.now, newId: () => `id-${++this.seq}` });
  service = new TopicService({ repo: this.repo, freshSession: false });
  state: LiveState = emptyLiveState();
  now = T0;
  calls: string[] = [];
  private seq = 0;
  private nextWindow = 100;
  private nextTab = 1000;

  actions: ChromeActions = {
    activateTab: async (id) => {
      this.calls.push(`activate ${id}`);
      const t = this.state.tabs[id];
      if (t) await this.emit({ type: 'tab.activated', tabId: id, windowId: t.windowId });
    },
    focusWindow: async (id) => {
      this.calls.push(`focus ${id}`);
      await this.emit({ type: 'window.focused', windowId: id });
    },
    moveTabs: async (ids, windowId) => {
      this.calls.push(`move [${ids.join(',')}] -> ${windowId}`);
      for (const id of ids) {
        const t = this.state.tabs[id]!;
        const old = t.windowId;
        await this.emit(
          { type: 'tab.detached', tabId: id, oldWindowId: old, oldPosition: t.index },
          {
            type: 'tab.attached',
            tabId: id,
            newWindowId: windowId,
            newPosition: this.state.windows[windowId]!.tabIds.length,
          },
        );
        if (this.state.windows[old]!.tabIds.length === 0) {
          await this.emit({ type: 'window.removed', windowId: old });
        }
      }
    },
    createWindow: async (opts) => {
      const windowId = this.nextWindow++;
      this.calls.push(
        `create ${opts.tabId !== undefined ? `tab ${opts.tabId}` : `urls ${(opts.urls ?? []).length}`} -> ${windowId}`,
      );
      await this.emit({ type: 'window.created', window: { id: windowId, focused: true } });
      if (opts.tabId !== undefined) {
        await this.actions.moveTabs([opts.tabId], windowId);
      } else {
        for (const url of opts.urls ?? ['about:blank']) {
          await this.emit({ type: 'tab.created', tab: this.tab(this.nextTab++, windowId, url) });
        }
      }
      return windowId;
    },
    waitForWindow: async () => {},
    tabsOfWindow: async (windowId) =>
      (this.state.windows[windowId]?.tabIds ?? []).map((id) => ({
        id,
        url: this.state.tabs[id]!.url,
      })),
  };

  runner = new CommandRunner({ repo: this.repo, service: this.service, actions: this.actions });

  tab(id: number, windowId: number, url: string, title = `Tab ${id}`): LiveTab {
    return {
      id,
      windowId,
      index: this.state.windows[windowId]?.tabIds.length ?? 0,
      url,
      title,
      active: false,
      pinned: false,
    };
  }

  async init() {
    await this.repo.init();
    await this.emit({
      type: 'init',
      windows: [
        {
          id: 10,
          focused: true,
          tabs: [
            { ...this.tab(1, 10, 'https://a.com/1'), index: 0, active: true },
            { ...this.tab(2, 10, 'https://a.com/2'), index: 1 },
          ],
        },
        { id: 20, focused: false, tabs: [{ ...this.tab(3, 20, 'https://b.com/1'), active: true }] },
      ],
    });
    return this;
  }

  async emit(...events: LiveEvent[]) {
    for (const e of events) {
      this.now += 1000;
      this.state = reduce(this.state, e);
      await this.service.apply(e, this.state);
      const v = checkInvariants(this.repo.snapshot());
      if (v.length) throw new Error(`after ${e.type}: ${v.map((x) => x.code).join(',')}`);
    }
  }

  async closeWindow(windowId: number) {
    const ids = this.state.windows[windowId]?.tabIds ?? [];
    await this.emit(
      ...ids.map((tabId): LiveEvent => ({
        type: 'tab.removed',
        tabId,
        windowId,
        isWindowClosing: true,
      })),
      { type: 'window.removed', windowId },
    );
  }

  topicOf(windowId: number) {
    return this.repo.findTopicByWindow(windowId)!;
  }
}

describe('CommandRunner.focus', () => {
  let w: World;
  beforeEach(async () => {
    w = await new World().init();
  });

  it('open tab: activate + focus window; mode window skips activation', async () => {
    const row = w.repo.findTabByChromeId(2)!;
    const r = await w.runner.focus({ kind: 'tab', tabRowId: row.id });
    expect(r).toEqual({ windowId: 10, chromeTabId: 2 });
    expect(w.calls).toEqual(['activate 2', 'focus 10']);

    w.calls = [];
    await w.runner.focus({ kind: 'tab', tabRowId: row.id }, 'window');
    expect(w.calls).toEqual(['focus 10']);
  });

  it('open topic: focus its window', async () => {
    const r = await w.runner.focus({ kind: 'topic', topicId: w.topicOf(20).id });
    expect(r).toEqual({ windowId: 20 });
    expect(w.calls).toEqual(['focus 20']);
  });

  it('a closed window has no topic: focusing it is an error, nothing is reopened', async () => {
    const topic = w.topicOf(20);
    await w.service.rename(topic.id, 'B work');
    await w.closeWindow(20);
    expect(w.repo.getTopic(topic.id)).toBeUndefined();
    await expect(w.runner.focus({ kind: 'topic', topicId: topic.id })).rejects.toMatchObject({
      code: 'topic.notFound',
    });
    expect(w.calls).toEqual([]); // no createWindow
  });

  it('chromeTab target', async () => {
    await w.runner.focus({ kind: 'chromeTab', chromeTabId: 3, windowId: 20 });
    expect(w.calls).toEqual(['activate 3', 'focus 20']);
  });

  it('unknown ids throw TopicError', async () => {
    await expect(w.runner.focus({ kind: 'topic', topicId: 'nope' })).rejects.toMatchObject({
      code: 'topic.notFound',
    });
    await expect(w.runner.focus({ kind: 'tab', tabRowId: 'nope' })).rejects.toMatchObject({
      code: 'topic.notFound',
    });
  });
});

describe('CommandRunner.move / newTopic / rename / merge', () => {
  let w: World;
  beforeEach(async () => {
    w = await new World().init();
  });

  it('move to an open topic: tabs.move, rows re-parented, move log written, last topic remembered', async () => {
    const target = w.topicOf(20);
    const r = await w.runner.move({ topicId: target.id, chromeTabIds: [1] });
    expect(r).toEqual({ topicId: target.id, windowId: 20, moved: 1 });
    expect(w.calls).toEqual(['move [1] -> 20']);
    expect(w.repo.findTabByChromeId(1)!.topicId).toBe(target.id);
    expect(w.repo.listMoveLog()).toMatchObject([
      { host: 'a.com', pathPrefix: '/1', topicId: target.id },
    ]);
    expect(w.runner.lastMoveTopicId).toBe(target.id);
  });

  it('move skips tabs already in the target and can switch focus', async () => {
    const target = w.topicOf(20);
    const r = await w.runner.move({ topicId: target.id, chromeTabIds: [3, 2], switchTo: true });
    expect(r.moved).toBe(1);
    expect(w.calls).toEqual(['move [2] -> 20', 'focus 20']);
  });

  it('moving the last tab out of an unnamed window drops that topic', async () => {
    const from = w.topicOf(20);
    await w.runner.move({ topicId: w.topicOf(10).id, chromeTabIds: [3] });
    expect(w.state.windows[20]).toBeUndefined();
    expect(w.repo.getTopic(from.id)).toBeUndefined();
  });

  it('move with no tabs throws', async () => {
    await expect(
      w.runner.move({ topicId: w.topicOf(20).id, chromeTabIds: [] }),
    ).rejects.toMatchObject({ code: 'topic.notFound' });
  });

  it('newTopic splits tabs into a new window and names it', async () => {
    const topic = await w.runner.newTopic({ chromeTabIds: [1, 2], name: '새 작업' });
    expect(topic).toMatchObject({ name: '새 작업', isNamed: true, status: 'open', windowId: 100 });
    expect(w.calls).toEqual(['create tab 1 -> 100', 'move [1] -> 100', 'move [2] -> 100']);
    expect(w.state.windows[10]).toBeUndefined(); // emptied window closed
    expect(w.repo.listTabs({ topicId: topic.id })).toHaveLength(2);
  });

  it('newTopic without a name keeps the auto name', async () => {
    const topic = await w.runner.newTopic({ chromeTabIds: [3] });
    expect(topic.isNamed).toBe(false);
    expect(topic.name).toBe('b.com');
  });

  it('rename by windowId', async () => {
    const t = await w.runner.rename({ name: 'Front', windowId: 10 });
    expect(t).toMatchObject({ name: 'Front', windowId: 10 });
    await expect(w.runner.rename({ name: 'X', windowId: 999 })).rejects.toMatchObject({
      code: 'topic.notFound',
    });
  });

  it('merge moves every tab of the current window into the target', async () => {
    const target = w.topicOf(20);
    const r = await w.runner.merge({ topicId: target.id, fromWindowId: 10 });
    expect(r.moved).toBe(2);
    expect(w.state.windows[10]).toBeUndefined();
    expect(w.repo.listTabs({ topicId: target.id, isOpen: true })).toHaveLength(3);
    expect(w.calls.at(-1)).toBe('focus 20');
  });
});
