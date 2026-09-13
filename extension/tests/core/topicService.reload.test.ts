import { describe, expect, it } from 'vitest';
import { fingerprint } from '../../src/core/fingerprint';
import { checkInvariants } from '../../src/core/invariants';
import { emptyLiveState, type LiveEvent, type LiveState, reduce } from '../../src/core/liveState';
import type { Tab, Topic } from '../../src/core/model';
import { MemoryKV, Repo } from '../../src/core/repo';
import { jaccard, TopicService } from '../../src/core/topicService';

const T0 = 1_700_000_000_000;

function liveTab(id: number, windowId: number, index: number, url: string, title = url) {
  return { id, windowId, index, url, title, active: index === 0, pinned: false };
}

/** Storage as left by a previous browser session: an open topic bound to windowId 10. */
async function seedPreviousSession(repo: Repo, over: Partial<Topic> = {}) {
  const topic: Topic = {
    id: 'prev',
    name: 'Work',
    isNamed: true,
    status: 'open',
    windowId: 10,
    browser: 'chrome',
    lastActiveAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
  await repo.putTopic(topic);
  const urls = ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'];
  await repo.putTabs(
    urls.map((url, i): Tab => ({
      id: `prev-${i}`,
      topicId: topic.id,
      fingerprint: fingerprint(url, url),
      url,
      title: url,
      chromeTabId: 500 + i, // stale ids from the old session
      index: i,
      isOpen: true,
      lastActiveAt: 1,
      updatedAt: 1,
    })),
  );
  return topic;
}

async function freshReload(repo: Repo, windows: Extract<LiveEvent, { type: 'init' }>['windows']) {
  const service = new TopicService({ repo, freshSession: true });
  const state: LiveState = reduce(emptyLiveState(), { type: 'init', windows });
  await service.apply({ type: 'init', windows }, state);
  expect(checkInvariants(repo.snapshot())).toEqual([]);
  return { service, state };
}

describe('reload / restart: re-link instead of duplicating', () => {
  it('a window with the same tabs re-links to the stale topic (same id, name, rows) — no saved copy', async () => {
    const repo = new Repo(new MemoryKV(), { now: () => T0, newId: () => crypto.randomUUID() });
    await repo.init();
    await seedPreviousSession(repo);

    // After reload Chrome reuses windowId 10 for the SAME window; tab ids are new.
    await freshReload(repo, [
      {
        id: 10,
        focused: true,
        tabs: [
          liveTab(1, 10, 0, 'https://a.com/1'),
          liveTab(2, 10, 1, 'https://a.com/2'),
          liveTab(3, 10, 2, 'https://a.com/3'),
        ],
      },
    ]);

    const topics = repo.listTopics();
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ id: 'prev', name: 'Work', status: 'open', windowId: 10 });
    const rows = repo.listTabs({ topicId: 'prev' });
    expect(rows.map((r) => [r.id, r.chromeTabId, r.isOpen])).toEqual([
      ['prev-0', 1, true],
      ['prev-1', 2, true],
      ['prev-2', 3, true],
    ]);
  });

  it('re-links even when Chrome assigned a different windowId, and drops tabs closed meanwhile', async () => {
    const repo = new Repo(new MemoryKV(), { now: () => T0, newId: () => crypto.randomUUID() });
    await repo.init();
    await seedPreviousSession(repo);

    await freshReload(repo, [
      {
        id: 77,
        focused: true,
        tabs: [liveTab(1, 77, 0, 'https://a.com/1'), liveTab(2, 77, 1, 'https://a.com/2')],
      },
    ]);
    expect(repo.listTopics()).toHaveLength(1);
    expect(repo.getTopic('prev')).toMatchObject({ status: 'open', windowId: 77 });
    expect(repo.listTabs({ topicId: 'prev' }).map((r) => r.url)).toEqual([
      'https://a.com/1',
      'https://a.com/2',
    ]);
  });

  it('a stale topic with no matching window is dropped; unrelated windows get new topics', async () => {
    const repo = new Repo(new MemoryKV(), { now: () => T0, newId: () => crypto.randomUUID() });
    await repo.init();
    await seedPreviousSession(repo);

    await freshReload(repo, [
      { id: 10, focused: true, tabs: [liveTab(1, 10, 0, 'https://zzz.com/')] },
    ]);
    expect(repo.getTopic('prev')).toBeUndefined();
    expect(repo.listTabs({ topicId: 'prev' })).toEqual([]);
    expect(repo.findTopicByWindow(10)).toMatchObject({ status: 'open', name: 'zzz.com' });
  });

  it('legacy saved duplicates of an open window are absorbed; the live topic inherits the name', async () => {
    const repo = new Repo(new MemoryKV(), { now: () => T0, newId: () => crypto.randomUUID() });
    await repo.init();
    // Two leftovers from earlier reloads with the same tab set: one unnamed, one named.
    for (const [id, isNamed] of [
      ['dupUnnamed', false],
      ['dupNamed', true],
    ] as const) {
      await repo.putTopic({
        id,
        name: isNamed ? 'Keep me' : 'a.com',
        isNamed,
        status: 'saved',
        browser: 'chrome',
        lastActiveAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await repo.putTabs(
        ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'].map((url, i): Tab => ({
          id: `${id}-${i}`,
          topicId: id,
          fingerprint: fingerprint(url, url),
          url,
          title: url,
          index: i,
          isOpen: false,
          lastActiveAt: 1,
          updatedAt: 1,
        })),
      );
    }

    await freshReload(repo, [
      {
        id: 10,
        focused: true,
        tabs: [
          liveTab(1, 10, 0, 'https://a.com/1'),
          liveTab(2, 10, 1, 'https://a.com/2'),
          liveTab(3, 10, 2, 'https://a.com/3'),
        ],
      },
    ]);

    // Both duplicates are absorbed; the (unnamed) live topic inherits the name "Keep me".
    const topics = repo.listTopics();
    expect(topics.map((t) => t.id)).not.toContain('dupUnnamed');
    expect(topics.map((t) => t.id)).not.toContain('dupNamed');
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      status: 'open',
      windowId: 10,
      name: 'Keep me',
      isNamed: true,
    });
    expect(repo.listTabs({ topicId: 'dupUnnamed' })).toEqual([]);
    expect(repo.listTabs({ topicId: 'dupNamed' })).toEqual([]);
  });

  it('a named open topic keeps its own name when absorbing a named duplicate', async () => {
    const repo = new Repo(new MemoryKV(), { now: () => T0, newId: () => crypto.randomUUID() });
    await repo.init();
    await seedPreviousSession(repo, { id: 'live', name: 'Current', windowId: 10 });
    await repo.putTopic({
      id: 'dup',
      name: 'Old name',
      isNamed: true,
      status: 'saved',
      browser: 'chrome',
      lastActiveAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await repo.putTabs(
      ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'].map((url, i): Tab => ({
        id: `dup-${i}`,
        topicId: 'dup',
        fingerprint: fingerprint(url, url),
        url,
        title: url,
        index: i,
        isOpen: false,
        lastActiveAt: 1,
        updatedAt: 1,
      })),
    );
    await freshReload(repo, [
      {
        id: 10,
        focused: true,
        tabs: [
          liveTab(1, 10, 0, 'https://a.com/1'),
          liveTab(2, 10, 1, 'https://a.com/2'),
          liveTab(3, 10, 2, 'https://a.com/3'),
        ],
      },
    ]);
    const topics = repo.listTopics();
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ id: 'live', name: 'Current', status: 'open' });
  });

  it('two similar windows are matched one-to-one by best overlap', async () => {
    const repo = new Repo(new MemoryKV(), { now: () => T0, newId: () => crypto.randomUUID() });
    await repo.init();
    await seedPreviousSession(repo); // prev: a.com/1,2,3 on windowId 10
    await repo.putTopic({
      id: 'prev2',
      name: 'Other',
      isNamed: true,
      status: 'open',
      windowId: 11,
      browser: 'chrome',
      lastActiveAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await repo.putTabs(
      ['https://a.com/1', 'https://b.com/9'].map((url, i): Tab => ({
        id: `p2-${i}`,
        topicId: 'prev2',
        fingerprint: fingerprint(url, url),
        url,
        title: url,
        chromeTabId: 600 + i,
        index: i,
        isOpen: true,
        lastActiveAt: 1,
        updatedAt: 1,
      })),
    );

    await freshReload(repo, [
      {
        id: 20,
        focused: true,
        tabs: [liveTab(1, 20, 0, 'https://a.com/1'), liveTab(2, 20, 1, 'https://b.com/9')],
      },
      {
        id: 21,
        focused: false,
        tabs: [
          liveTab(3, 21, 0, 'https://a.com/1'),
          liveTab(4, 21, 1, 'https://a.com/2'),
          liveTab(5, 21, 2, 'https://a.com/3'),
        ],
      },
    ]);
    expect(repo.findTopicByWindow(20)!.id).toBe('prev2');
    expect(repo.findTopicByWindow(21)!.id).toBe('prev');
  });

  it('unnamed saved leftovers are purged on reload even when they match nothing', async () => {
    const repo = new Repo(new MemoryKV(), { now: () => T0, newId: () => crypto.randomUUID() });
    await repo.init();
    await repo.putTopic({
      id: 'junk',
      name: 'file://C:',
      isNamed: false,
      status: 'saved',
      browser: 'chrome',
      lastActiveAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await repo.putTab({
      id: 'junk-0',
      topicId: 'junk',
      fingerprint: 'x',
      url: 'file:///C:/doc.pdf',
      title: 'doc',
      index: 0,
      isOpen: false,
      lastActiveAt: 1,
      updatedAt: 1,
    });
    await freshReload(repo, [
      { id: 10, focused: true, tabs: [liveTab(1, 10, 0, 'https://a.com/')] },
    ]);
    expect(repo.getTopic('junk')).toBeUndefined();
    expect(repo.listTabs({ topicId: 'junk' })).toEqual([]);
  });

  it('jaccard basics', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
    expect(jaccard(new Set(['a']), new Set(['a']))).toBe(1);
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
  });
});
