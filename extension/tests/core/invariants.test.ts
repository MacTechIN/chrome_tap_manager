import { describe, expect, it } from 'vitest';
import { assertInvariants, checkInvariants } from '../../src/core/invariants';
import { emptyStore, type Store, type Tab, type Topic } from '../../src/core/model';

const T = 1_000;

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

function codes(store: Store): string[] {
  return checkInvariants(store).map((v) => v.code);
}

describe('checkInvariants', () => {
  it('accepts an empty store', () => {
    expect(codes(emptyStore())).toEqual([]);
  });

  it('accepts a consistent open topic with open tabs', () => {
    const store: Store = {
      ...emptyStore(),
      topics: [topic()],
      tabs: [tab(), tab({ id: 'tab2', chromeTabId: 101, index: 1 })],
    };
    expect(codes(store)).toEqual([]);
    expect(() => assertInvariants(store)).not.toThrow();
  });

  it('accepts a saved topic with closed tabs', () => {
    const store: Store = {
      ...emptyStore(),
      topics: [topic({ status: 'saved', windowId: undefined })],
      tabs: [tab({ isOpen: false, chromeTabId: undefined })],
    };
    expect(codes(store)).toEqual([]);
  });

  it('flags open topic without window and saved topic with window', () => {
    const store: Store = {
      ...emptyStore(),
      topics: [
        topic({ id: 'a', windowId: undefined }),
        topic({ id: 'b', name: 'B', status: 'saved', windowId: 5 }),
      ],
    };
    expect(codes(store)).toEqual(['topic.openWithoutWindow', 'topic.savedWithWindow']);
  });

  it('flags two open topics on the same window', () => {
    const store: Store = {
      ...emptyStore(),
      topics: [topic({ id: 'a' }), topic({ id: 'b', name: 'B', windowId: 10 })],
    };
    expect(codes(store)).toEqual(['topic.duplicateWindow']);
  });

  it('flags duplicate names only among named topics (case-insensitive)', () => {
    const named: Store = {
      ...emptyStore(),
      topics: [topic({ id: 'a', name: 'Dev' }), topic({ id: 'b', name: ' dev ', windowId: 11 })],
    };
    expect(codes(named)).toEqual(['topic.duplicateName']);

    const unnamed: Store = {
      ...emptyStore(),
      topics: [
        topic({ id: 'a', name: 'github.com', isNamed: false }),
        topic({ id: 'b', name: 'github.com', isNamed: false, windowId: 11 }),
      ],
    };
    expect(codes(unnamed)).toEqual([]);
  });

  it('flags tab problems: orphan topic, open in saved topic, chrome id mismatches', () => {
    const store: Store = {
      ...emptyStore(),
      topics: [topic({ id: 'saved', status: 'saved', windowId: undefined })],
      tabs: [
        tab({ id: 'x', topicId: 'missing', chromeTabId: 100 }),
        tab({ id: 'y', topicId: 'saved', chromeTabId: 101 }),
        tab({ id: 'z', topicId: 'saved', isOpen: true, chromeTabId: undefined }),
        tab({ id: 'w', topicId: 'saved', isOpen: false, chromeTabId: 7 }),
      ],
    };
    expect(codes(store)).toEqual([
      'tab.orphanTopic',
      'tab.openInSavedTopic',
      'tab.openInSavedTopic',
      'tab.openWithoutChromeId',
      'tab.closedWithChromeId',
    ]);
  });

  it('flags duplicate chromeTabId among open tabs', () => {
    const store: Store = {
      ...emptyStore(),
      topics: [topic()],
      tabs: [tab({ id: 'a' }), tab({ id: 'b' })],
    };
    expect(codes(store)).toEqual(['tab.duplicateChromeId']);
  });

  it('flags subgroup problems', () => {
    const store: Store = {
      ...emptyStore(),
      topics: [topic({ id: 't1' }), topic({ id: 't2', name: 'Other', windowId: 11 })],
      subgroups: [
        { id: 'g1', topicId: 't2', name: 'g', collapsed: false },
        { id: 'gx', topicId: 'nope', name: 'g', collapsed: false },
      ],
      tabs: [
        tab({ id: 'a', subgroupId: 'g1' }),
        tab({ id: 'b', chromeTabId: 101, subgroupId: 'missing' }),
      ],
    };
    expect(codes(store)).toEqual([
      'subgroup.orphanTopic',
      'tab.subgroupTopicMismatch',
      'tab.orphanSubgroup',
    ]);
  });

  it('rules are keyed by topic name and never orphan-checked; assertInvariants throws on real violations', () => {
    const store: Store = {
      ...emptyStore(),
      rules: [
        {
          id: 'r',
          topicName: 'Gone',
          kind: 'host',
          pattern: 'github.com',
          priority: 0,
          source: 'manual',
          enabled: true,
          undoCount: 0,
          createdAt: 0,
        },
      ],
    };
    expect(codes(store)).toEqual([]);
    const bad: Store = { ...emptyStore(), topics: [topic({ windowId: undefined })] };
    expect(() => assertInvariants(bad)).toThrow(/topic.openWithoutWindow/);
  });
});
