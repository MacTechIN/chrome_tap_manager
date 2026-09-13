import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ChromeStorageKV } from '../../src/chrome/storageKv';
import {
  MOVE_LOG_LIMIT,
  SCHEMA_VERSION,
  type MoveLogEntry,
  type Rule,
  type Subgroup,
  type Tab,
  type Topic,
} from '../../src/core/model';
import { collectionKey, type KeyValueStore, MemoryKV, META_KEY, Repo } from '../../src/core/repo';

const T = 1_700_000_000_000;

function topic(over: Partial<Topic> = {}): Topic {
  return {
    id: 't1',
    name: 'ProjectA',
    isNamed: true,
    status: 'open',
    windowId: 10,
    browser: 'chrome',
    lastActiveAt: T,
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

function tab(over: Partial<Tab> = {}): Tab {
  return {
    id: 'tab1',
    topicId: 't1',
    fingerprint: 'f',
    url: 'https://example.com/',
    title: 'Example',
    chromeTabId: 100,
    index: 0,
    isOpen: true,
    lastActiveAt: T,
    updatedAt: T,
    ...over,
  };
}

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: 'r1',
    topicId: 't1',
    kind: 'host',
    pattern: 'github.com',
    priority: 0,
    source: 'manual',
    enabled: true,
    undoCount: 0,
    ...over,
  };
}

const backends: { name: string; make: () => KeyValueStore; reset: () => void }[] = [
  { name: 'MemoryKV', make: () => new MemoryKV(), reset: () => {} },
  {
    name: 'ChromeStorageKV(local)',
    make: () => new ChromeStorageKV('local'),
    reset: () => fakeBrowser.reset(),
  },
];

describe.each(backends)('Repo over $name', ({ make, reset }) => {
  let kv: KeyValueStore;
  let repo: Repo;
  let seq = 0;

  beforeEach(async () => {
    reset();
    kv = make();
    seq = 0;
    repo = new Repo(kv, { now: () => T, newId: () => `id-${++seq}` });
    await repo.init();
  });

  it('init on fresh storage writes meta and empty collections', async () => {
    const meta = await kv.get<{ schemaVersion: number }>(META_KEY);
    expect(meta).toEqual({ schemaVersion: SCHEMA_VERSION });
    expect(await kv.get(collectionKey('topics'))).toEqual([]);
    expect(repo.snapshot()).toEqual({
      topics: [],
      tabs: [],
      subgroups: [],
      rules: [],
      moveLog: [],
    });
  });

  it('init result reports fresh vs existing', async () => {
    const again = new Repo(kv);
    const r = await again.init();
    expect(r).toEqual({ schemaVersion: SCHEMA_VERSION, migrated: false, fresh: false });
  });

  it('methods throw before init', async () => {
    const r = new Repo(make());
    expect(() => r.listTopics()).toThrow(/init/);
    await expect(r.putTopic(topic())).rejects.toThrow(/init/);
  });

  it('topic CRUD and lookup by window', async () => {
    await repo.putTopic(topic());
    expect(repo.getTopic('t1')?.name).toBe('ProjectA');
    expect(repo.findTopicByWindow(10)?.id).toBe('t1');
    expect(repo.findTopicByWindow(99)).toBeUndefined();

    await repo.putTopic(topic({ name: 'Renamed' }));
    expect(repo.listTopics()).toHaveLength(1);
    expect(repo.getTopic('t1')?.name).toBe('Renamed');

    expect(await repo.deleteTopic('t1')).toBe(true);
    expect(await repo.deleteTopic('t1')).toBe(false);
    expect(repo.listTopics()).toEqual([]);
  });

  it('persists across a new Repo instance on the same backend', async () => {
    await repo.putTopic(topic());
    await repo.putTab(tab());
    const again = new Repo(kv);
    await again.init();
    expect(again.getTopic('t1')?.name).toBe('ProjectA');
    expect(again.listTabs({ topicId: 't1' })).toHaveLength(1);
  });

  it('snapshot returns a copy, not a live reference', async () => {
    await repo.putTopic(topic());
    const s = repo.snapshot();
    s.topics[0]!.name = 'mutated';
    expect(repo.getTopic('t1')?.name).toBe('ProjectA');
  });

  it('tab CRUD, filters and chrome id lookup', async () => {
    await repo.putTopic(topic());
    await repo.putTopic(topic({ id: 't2', name: 'B', windowId: 11 }));
    await repo.putTabs([
      tab({ id: 'a' }),
      tab({ id: 'b', chromeTabId: 101, index: 1 }),
      tab({ id: 'c', topicId: 't2', chromeTabId: 102 }),
      tab({ id: 'd', topicId: 't2', isOpen: false, chromeTabId: undefined }),
    ]);

    expect(repo.listTabs()).toHaveLength(4);
    expect(repo.listTabs({ topicId: 't1' }).map((t) => t.id)).toEqual(['a', 'b']);
    expect(repo.listTabs({ topicId: 't2', isOpen: true }).map((t) => t.id)).toEqual(['c']);
    expect(repo.listTabs({ isOpen: false }).map((t) => t.id)).toEqual(['d']);
    expect(repo.findTabByChromeId(101)?.id).toBe('b');
    expect(repo.findTabByChromeId(999)).toBeUndefined();

    await repo.putTab(tab({ id: 'a', title: 'Changed' }));
    expect(repo.getTab('a')?.title).toBe('Changed');
    expect(repo.listTabs()).toHaveLength(4);

    expect(await repo.deleteTab('a')).toBe(true);
    expect(await repo.deleteTab('a')).toBe(false);
    expect(await repo.deleteTabsByTopic('t2')).toBe(2);
    expect(repo.listTabs().map((t) => t.id)).toEqual(['b']);
  });

  it('deleteTopic cascades to tabs, subgroups, rules and move log', async () => {
    await repo.putTopic(topic());
    await repo.putTopic(topic({ id: 't2', name: 'B', windowId: 11 }));
    await repo.putTabs([tab({ id: 'a' }), tab({ id: 'c', topicId: 't2', chromeTabId: 102 })]);
    await repo.putSubgroup({ id: 'g1', topicId: 't1', name: 'g', collapsed: false });
    await repo.putRule(rule());
    await repo.putRule(rule({ id: 'r2', topicId: 't2' }));
    await repo.appendMoveLog({ id: 'm1', host: 'x', pathPrefix: '/', topicId: 't1', movedAt: T });
    await repo.appendMoveLog({ id: 'm2', host: 'x', pathPrefix: '/', topicId: 't2', movedAt: T });

    await repo.deleteTopic('t1');

    expect(repo.listTabs().map((t) => t.id)).toEqual(['c']);
    expect(repo.listSubgroups()).toEqual([]);
    expect(repo.listRules().map((r) => r.id)).toEqual(['r2']);
    expect(repo.listMoveLog().map((m) => m.id)).toEqual(['m2']);
    // persisted, not just cached
    expect(await kv.get<Tab[]>(collectionKey('tabs'))).toHaveLength(1);
  });

  it('subgroup CRUD; deleting a subgroup detaches its tabs', async () => {
    await repo.putTopic(topic());
    const g: Subgroup = { id: 'g1', topicId: 't1', name: 'Docs', collapsed: false };
    await repo.putSubgroup(g);
    await repo.putTab(tab({ id: 'a', subgroupId: 'g1' }));
    expect(repo.listSubgroups('t1')).toEqual([g]);

    expect(await repo.deleteSubgroup('g1')).toBe(true);
    expect(await repo.deleteSubgroup('g1')).toBe(false);
    expect(repo.getTab('a')?.subgroupId).toBeUndefined();
    expect((await kv.get<Tab[]>(collectionKey('tabs')))![0]!.subgroupId).toBeUndefined();
  });

  it('rules are listed by priority', async () => {
    await repo.putTopic(topic());
    await repo.putRule(rule({ id: 'r-high', priority: 5 }));
    await repo.putRule(rule({ id: 'r-low', priority: 1 }));
    expect(repo.listRules().map((r) => r.id)).toEqual(['r-low', 'r-high']);
    expect(await repo.deleteRule('r-low')).toBe(true);
    expect(repo.listRules().map((r) => r.id)).toEqual(['r-high']);
  });

  it('move log is capped at MOVE_LOG_LIMIT, dropping oldest', async () => {
    await repo.putTopic(topic());
    for (let i = 0; i < MOVE_LOG_LIMIT + 5; i++) {
      const e: MoveLogEntry = {
        id: `m${i}`,
        host: 'h',
        pathPrefix: '/',
        topicId: 't1',
        movedAt: i,
      };
      await repo.appendMoveLog(e);
    }
    const log = repo.listMoveLog();
    expect(log).toHaveLength(MOVE_LOG_LIMIT);
    expect(log[0]!.id).toBe('m5');
    expect(log[log.length - 1]!.id).toBe(`m${MOVE_LOG_LIMIT + 4}`);
  });

  it('replaceAll and clear', async () => {
    await repo.putTopic(topic());
    await repo.replaceAll({
      topics: [topic({ id: 'z', name: 'Z', windowId: 50 })],
      tabs: [],
      subgroups: [],
      rules: [],
      moveLog: [],
    });
    expect(repo.listTopics().map((t) => t.id)).toEqual(['z']);
    expect(await kv.get<Topic[]>(collectionKey('topics'))).toHaveLength(1);

    await repo.clear();
    expect(repo.listTopics()).toEqual([]);
    expect(await kv.get(collectionKey('topics'))).toEqual([]);
  });

  it('injected now/newId are exposed for services', () => {
    expect(repo.now()).toBe(T);
    expect(repo.newId()).toBe('id-1');
    expect(repo.newId()).toBe('id-2');
  });

  it('missing meta with existing data is NOT treated as fresh (data kept, meta rewritten)', async () => {
    await repo.putTopic(topic());
    await repo.putTab(tab());
    await kv.remove(META_KEY);

    const again = new Repo(kv);
    const r = await again.init();
    expect(r.fresh).toBe(false);
    expect(again.listTopics()).toHaveLength(1);
    expect(again.listTabs()).toHaveLength(1);
    expect(await kv.get<{ schemaVersion: number }>(META_KEY)).toEqual({
      schemaVersion: SCHEMA_VERSION,
    });
  });

  it('refuses a newer schema than supported', async () => {
    await kv.set(META_KEY, { schemaVersion: SCHEMA_VERSION + 1 });
    const r = new Repo(kv);
    await expect(r.init()).rejects.toThrow(/newer/);
  });
});
