import { beforeEach, describe, expect, it } from 'vitest';
import { checkInvariants } from '../../src/core/invariants';
import {
  emptyLiveState,
  groupsOf,
  type LiveEvent,
  type LiveGroup,
  type LiveState,
  type LiveTab,
  reduce,
} from '../../src/core/liveState';
import { MemoryKV, Repo } from '../../src/core/repo';
import { TopicService, toTopicColor } from '../../src/core/topicService';

const T0 = 1_700_000_000_000;

function tab(id: number, windowId: number, index: number, over: Partial<LiveTab> = {}): LiveTab {
  return {
    id,
    windowId,
    index,
    url: `https://s${windowId}.com/${id}`,
    title: `T${id}`,
    active: index === 0,
    pinned: false,
    ...over,
  };
}
function group(id: number, windowId: number, over: Partial<LiveGroup> = {}): LiveGroup {
  return { id, windowId, title: `G${id}`, color: 'blue', collapsed: false, ...over };
}

describe('liveState: groups', () => {
  it('init keeps groups of known windows; events upsert/remove; window.removed drops its groups', () => {
    let s = reduce(emptyLiveState(), {
      type: 'init',
      windows: [{ id: 10, focused: true, tabs: [tab(1, 10, 0)] }],
      groups: [group(100, 10), group(200, 99)],
    });
    expect(Object.keys(s.groups)).toEqual(['100']);
    s = reduce(s, {
      type: 'group.updated',
      group: group(100, 10, { title: 'Docs', collapsed: true }),
    });
    expect(s.groups[100]).toMatchObject({ title: 'Docs', collapsed: true });
    s = reduce(s, { type: 'group.created', group: group(101, 10) });
    expect(groupsOf(s, 10).map((g) => g.id)).toEqual([100, 101]);
    s = reduce(s, { type: 'group.removed', groupId: 101 });
    expect(groupsOf(s, 10).map((g) => g.id)).toEqual([100]);
    s = reduce(s, { type: 'window.removed', windowId: 10 });
    expect(s.groups).toEqual({});
  });

  it('toTopicColor accepts only the Chrome palette', () => {
    expect(toTopicColor('blue')).toBe('blue');
    expect(toTopicColor('neon')).toBeUndefined();
    expect(toTopicColor(undefined)).toBeUndefined();
  });
});

describe('TopicService: sub-groups mirror Chrome tab groups', () => {
  let repo: Repo;
  let service: TopicService;
  let state: LiveState;
  let now = T0;
  let seq = 0;

  const emit = async (...events: LiveEvent[]) => {
    for (const e of events) {
      now += 1000;
      state = reduce(state, e);
      await service.apply(e, state);
      expect(checkInvariants(repo.snapshot())).toEqual([]);
    }
  };

  beforeEach(async () => {
    seq = 0;
    now = T0;
    state = emptyLiveState();
    repo = new Repo(new MemoryKV(), { now: () => now, newId: () => `id-${++seq}` });
    await repo.init();
    service = new TopicService({ repo, freshSession: false });
    await emit({
      type: 'init',
      windows: [
        {
          id: 10,
          focused: true,
          tabs: [tab(1, 10, 0, { groupId: 100 }), tab(2, 10, 1, { groupId: 100 }), tab(3, 10, 2)],
        },
      ],
      groups: [group(100, 10, { title: 'Docs', color: 'green' })],
    });
  });

  it('init creates subgroup rows and binds tabs to them', () => {
    const topic = repo.findTopicByWindow(10)!;
    const groups = repo.listSubgroups(topic.id);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ name: 'Docs', color: 'green', chromeGroupId: 100 });
    expect(repo.findTabByChromeId(1)!.subgroupId).toBe(groups[0]!.id);
    expect(repo.findTabByChromeId(3)!.subgroupId).toBeUndefined();
  });

  it('group.updated renames/recolors; tab joining a group before it is known gets bound later', async () => {
    const topic = repo.findTopicByWindow(10)!;
    await emit({
      type: 'group.updated',
      group: group(100, 10, { title: 'Reference', color: 'red' }),
    });
    expect(repo.listSubgroups(topic.id)[0]).toMatchObject({ name: 'Reference', color: 'red' });

    // Tab 3 joins new group 101 — Chrome may fire tabs.onUpdated before tabGroups.onCreated.
    await emit({ type: 'tab.updated', tabId: 3, changes: { groupId: 101 } });
    expect(repo.findTabByChromeId(3)!.subgroupId).toBeUndefined();
    await emit({ type: 'group.created', group: group(101, 10, { title: 'New' }) });
    const g101 = repo.listSubgroups(topic.id).find((g) => g.chromeGroupId === 101)!;
    expect(repo.findTabByChromeId(3)!.subgroupId).toBe(g101.id);
  });

  it('ungrouping (group removed while tabs stay open) deletes the subgroup and detaches tabs', async () => {
    const topic = repo.findTopicByWindow(10)!;
    await emit(
      { type: 'tab.updated', tabId: 1, changes: { groupId: undefined } },
      { type: 'tab.updated', tabId: 2, changes: { groupId: undefined } },
      { type: 'group.removed', groupId: 100 },
    );
    expect(repo.listSubgroups(topic.id)).toEqual([]);
    expect(repo.findTabByChromeId(1)!.subgroupId).toBeUndefined();
  });

  it('closing the window drops the topic together with its subgroups and tabs', async () => {
    const topic = repo.findTopicByWindow(10)!;
    await service.rename(topic.id, 'Work');
    await emit(
      { type: 'tab.removed', tabId: 1, windowId: 10, isWindowClosing: true },
      { type: 'tab.removed', tabId: 2, windowId: 10, isWindowClosing: true },
      { type: 'tab.removed', tabId: 3, windowId: 10, isWindowClosing: true },
      { type: 'group.removed', groupId: 100 },
      { type: 'window.removed', windowId: 10 },
    );
    expect(repo.getTopic(topic.id)).toBeUndefined();
    expect(repo.listSubgroups()).toEqual([]);
    expect(repo.listTabs()).toEqual([]);
  });

  it('tree() nests subgroups and leaves ungrouped tabs at the topic level', () => {
    const [t] = service.tree();
    expect(t!.subgroups).toHaveLength(1);
    expect(t!.subgroups[0]!.tabs.map((x) => x.chromeTabId)).toEqual([1, 2]);
    expect(t!.tabs.map((x) => x.chromeTabId)).toEqual([3]);
  });

  it('setColor sets and clears the topic color', async () => {
    const topic = repo.findTopicByWindow(10)!;
    expect((await service.setColor(topic.id, 'purple')).color).toBe('purple');
    expect((await service.setColor(topic.id, undefined)).color).toBeUndefined();
  });
});
