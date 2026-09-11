// core/searchDocs.ts — build SearchDoc[] from a Repo snapshot.

import type { Store } from './model';
import { type SearchDoc, splitUrl } from './search/index';

export const topicDocId = (topicId: string): string => `topic:${topicId}`;
export const tabDocId = (tabRowId: string): string => `tab:${tabRowId}`;

export function buildSearchDocs(store: Store): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const tabCount = new Map<string, number>();
  for (const t of store.tabs) tabCount.set(t.topicId, (tabCount.get(t.topicId) ?? 0) + 1);
  const topicById = new Map(store.topics.map((t) => [t.id, t] as const));
  const subgroupName = new Map(store.subgroups.map((g) => [g.id, g.name] as const));

  for (const t of store.topics) {
    docs.push({
      kind: 'topic',
      id: topicDocId(t.id),
      topicId: t.id,
      name: t.name,
      isNamed: t.isNamed,
      status: t.status,
      windowId: t.windowId,
      tabCount: tabCount.get(t.id) ?? 0,
      lastActiveAt: t.lastActiveAt,
      description: t.description,
    });
  }

  for (const tab of store.tabs) {
    const topic = topicById.get(tab.topicId);
    if (!topic) continue;
    const { host, path } = splitUrl(tab.url);
    docs.push({
      kind: 'tab',
      id: tabDocId(tab.id),
      tabId: tab.id,
      topicId: topic.id,
      topicName: topic.name,
      title: tab.title,
      url: tab.url,
      host,
      path,
      windowId: tab.isOpen ? topic.windowId : undefined,
      chromeTabId: tab.isOpen ? tab.chromeTabId : undefined,
      isOpen: tab.isOpen,
      lastActiveAt: tab.lastActiveAt,
      favicon: tab.favicon,
      subgroupName: tab.subgroupId ? subgroupName.get(tab.subgroupId) : undefined,
    });
  }
  return docs;
}
