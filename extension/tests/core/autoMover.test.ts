import { beforeEach, describe, expect, it } from 'vitest';
import { AutoMover, UNDO_DISABLE_THRESHOLD } from '../../src/core/autoMover';
import type { Topic } from '../../src/core/model';
import { MemoryKV, Repo } from '../../src/core/repo';
import { makeRule } from '../../src/core/rules';
import { SettingsStore } from '../../src/core/settings';

const T0 = 1_700_000_000_000;

function topic(id: string, name: string, windowId: number): Topic {
  return {
    id,
    name,
    isNamed: true,
    status: 'open',
    windowId,
    browser: 'chrome',
    lastActiveAt: T0,
    createdAt: T0,
    updatedAt: T0,
  };
}

describe('AutoMover', () => {
  let repo: Repo;
  let settings: SettingsStore;
  let mover: AutoMover;
  let moves: string[];
  let seq: number;

  beforeEach(async () => {
    seq = 0;
    moves = [];
    repo = new Repo(new MemoryKV(), { now: () => T0, newId: () => `id-${++seq}` });
    await repo.init();
    settings = new SettingsStore(new MemoryKV());
    await settings.load();
    await repo.putTopic(topic('dev', 'Dev', 10));
    await repo.putTopic(topic('misc', 'Misc', 20));
    await repo.putRule(
      makeRule(
        { kind: 'host', pattern: 'github.com', topicName: 'Dev' },
        {
          newId: () => 'rule-gh',
          now: () => T0,
        },
      ),
    );
    mover = new AutoMover({
      repo,
      settings,
      actions: {
        moveTabs: async (ids, windowId) => {
          moves.push(`${ids.join(',')}->${windowId}`);
        },
      },
    });
  });

  it('moves a matching tab from another window into the rule topic and records it', async () => {
    const m = await mover.onTabUrl({ chromeTabId: 5, url: 'https://github.com/x', windowId: 20 });
    expect(m).toMatchObject({
      chromeTabId: 5,
      fromWindowId: 20,
      toWindowId: 10,
      toTopicName: 'Dev',
    });
    expect(moves).toEqual(['5->10']);
    expect(mover.recent()).toHaveLength(1);
  });

  it('leaves tabs alone when already in the target window, when nothing matches, or when disabled', async () => {
    expect(
      await mover.onTabUrl({ chromeTabId: 1, url: 'https://github.com/x', windowId: 10 }),
    ).toBeUndefined();
    expect(
      await mover.onTabUrl({ chromeTabId: 2, url: 'https://other.com/', windowId: 20 }),
    ).toBeUndefined();
    await settings.update({ rulesEnabled: false });
    expect(
      await mover.onTabUrl({ chromeTabId: 3, url: 'https://github.com/x', windowId: 20 }),
    ).toBeUndefined();
    expect(moves).toEqual([]);
  });

  it('never overrides a tab the user placed by hand', async () => {
    mover.markUserMoved([7]);
    expect(
      await mover.onTabUrl({ chromeTabId: 7, url: 'https://github.com/x', windowId: 20 }),
    ).toBeUndefined();
    mover.forget(7);
    expect(
      await mover.onTabUrl({ chromeTabId: 7, url: 'https://github.com/x', windowId: 20 }),
    ).toBeDefined();
  });

  it('does not re-route the same tab for the same rule on later url updates', async () => {
    await mover.onTabUrl({ chromeTabId: 5, url: 'https://github.com/x', windowId: 20 });
    // Chrome reports the tab now in window 10 but the page navigates within github
    expect(
      await mover.onTabUrl({ chromeTabId: 5, url: 'https://github.com/x#readme', windowId: 10 }),
    ).toBeUndefined();
    // the user drags it back to window 20 without our command → we still keep hands off
    expect(
      await mover.onTabUrl({ chromeTabId: 5, url: 'https://github.com/y', windowId: 20 }),
    ).toBeUndefined();
    expect(moves).toEqual(['5->10']);
  });

  it('skips rules whose topic window is closed', async () => {
    await repo.deleteTopic('dev');
    expect(
      await mover.onTabUrl({ chromeTabId: 5, url: 'https://github.com/x', windowId: 20 }),
    ).toBeUndefined();
  });

  it('undo moves the tab back, marks it user-moved, counts against the rule, disables after 3', async () => {
    const results = [];
    for (let i = 0; i < UNDO_DISABLE_THRESHOLD; i++) {
      const m = (await mover.onTabUrl({
        chromeTabId: 100 + i,
        url: 'https://github.com/x',
        windowId: 20,
      }))!;
      results.push(await mover.undo(m.id, () => true));
    }
    expect(moves).toEqual(['100->10', '100->20', '101->10', '101->20', '102->10', '102->20']);
    expect(results.slice(0, -1).every((r) => r.undone && !r.ruleDisabled)).toBe(true);
    expect(results.at(-1)!.ruleDisabled).toMatchObject({
      id: 'rule-gh',
      enabled: false,
      undoCount: 3,
    });
    expect(repo.listRules()[0]).toMatchObject({ enabled: false, undoCount: 3 });
    expect(mover.recent()).toEqual([]);
    // undone tab is now user-owned
    expect(
      await mover.onTabUrl({ chromeTabId: 100, url: 'https://github.com/z', windowId: 20 }),
    ).toBeUndefined();
  });

  it('undo when the origin window is gone still marks the tab and counts, but does not move', async () => {
    const m = (await mover.onTabUrl({
      chromeTabId: 5,
      url: 'https://github.com/x',
      windowId: 20,
    }))!;
    const r = await mover.undo(m.id, () => false);
    expect(r.undone).toBe(true);
    expect(moves).toEqual(['5->10']);
    expect(await mover.undo('nope', () => true)).toEqual({ undone: false });
  });

  it('recent(withinMs) filters by age', async () => {
    await mover.onTabUrl({ chromeTabId: 5, url: 'https://github.com/x', windowId: 20 });
    expect(mover.recent(1)).toHaveLength(1);
    expect(mover.recent(0)).toHaveLength(1); // same tick
  });
});
