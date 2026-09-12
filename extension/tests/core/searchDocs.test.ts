import { describe, expect, it } from 'vitest';
import { emptyStore, type Store } from '../../src/core/model';
import { buildSearchDocs } from '../../src/core/searchDocs';

describe('buildSearchDocs', () => {
  it('maps topics and tabs; saved tabs have no window/chrome ids; orphans skipped', () => {
    const store: Store = {
      ...emptyStore(),
      topics: [
        {
          id: 't1',
          name: 'Dev',
          isNamed: true,
          status: 'open',
          windowId: 10,
          browser: 'chrome',
          lastActiveAt: 5,
          createdAt: 1,
          updatedAt: 1,
          description: '개발 작업',
        },
        {
          id: 't2',
          name: 'Old',
          isNamed: true,
          status: 'saved',
          browser: 'chrome',
          lastActiveAt: 2,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      subgroups: [{ id: 'g1', topicId: 't1', name: 'Docs', collapsed: false }],
      tabs: [
        {
          id: 'a',
          topicId: 't1',
          fingerprint: 'f',
          url: 'https://www.github.com/x/y?z=1',
          title: 'Repo',
          chromeTabId: 100,
          subgroupId: 'g1',
          index: 0,
          isOpen: true,
          lastActiveAt: 4,
          updatedAt: 4,
          favicon: 'https://github.com/favicon.ico',
        },
        {
          id: 'b',
          topicId: 't2',
          fingerprint: 'f',
          url: 'https://old.com/',
          title: 'Old page',
          index: 0,
          isOpen: false,
          lastActiveAt: 2,
          updatedAt: 2,
        },
        {
          id: 'orphan',
          topicId: 'missing',
          fingerprint: 'f',
          url: 'https://o.com/',
          title: 'Orphan',
          index: 0,
          isOpen: false,
          lastActiveAt: 1,
          updatedAt: 1,
        },
      ],
    };

    // A saved copy of an open tab (same fingerprint) must not be listed.
    store.tabs.push({
      id: 'dup',
      topicId: 't2',
      fingerprint: 'f-open',
      url: 'https://www.github.com/x/y?z=1',
      title: 'Repo',
      index: 1,
      isOpen: false,
      lastActiveAt: 1,
      updatedAt: 1,
    });
    store.tabs[0]!.fingerprint = 'f-open';

    const docs = buildSearchDocs(store);
    expect(docs.map((d) => d.id)).toEqual(['topic:t1', 'topic:t2', 'tab:a', 'tab:b']);
    expect(docs[0]).toMatchObject({
      kind: 'topic',
      tabCount: 1,
      description: '개발 작업',
      windowId: 10,
    });
    expect(docs[2]).toMatchObject({
      kind: 'tab',
      topicName: 'Dev',
      host: 'github.com',
      path: '/x/y?z=1',
      windowId: 10,
      chromeTabId: 100,
      isOpen: true,
      subgroupName: 'Docs',
      favicon: 'https://github.com/favicon.ico',
    });
    expect(docs[3]).toMatchObject({
      kind: 'tab',
      isOpen: false,
      windowId: undefined,
      chromeTabId: undefined,
    });
  });
});
