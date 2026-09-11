// core/invariants.ts — the "one window = one topic" data invariants.
// Used by tests (E02+) and by debug assertions in the service worker (E04+).

import { type Store, topicNameKey } from './model';

export interface InvariantViolation {
  code:
    | 'topic.duplicateId'
    | 'topic.openWithoutWindow'
    | 'topic.savedWithWindow'
    | 'topic.duplicateWindow'
    | 'topic.duplicateName'
    | 'tab.duplicateId'
    | 'tab.orphanTopic'
    | 'tab.openInSavedTopic'
    | 'tab.openWithoutChromeId'
    | 'tab.closedWithChromeId'
    | 'tab.duplicateChromeId'
    | 'tab.orphanSubgroup'
    | 'tab.subgroupTopicMismatch'
    | 'subgroup.orphanTopic'
    | 'rule.orphanTopic';
  message: string;
  id?: string;
}

export function checkInvariants(store: Store): InvariantViolation[] {
  const v: InvariantViolation[] = [];
  const topicById = new Map<string, Store['topics'][number]>();
  const windowSeen = new Map<number, string>();
  const nameSeen = new Map<string, string>();

  for (const t of store.topics) {
    if (topicById.has(t.id)) {
      v.push({ code: 'topic.duplicateId', message: `topic id duplicated: ${t.id}`, id: t.id });
      continue;
    }
    topicById.set(t.id, t);

    if (t.status === 'open' && t.windowId === undefined) {
      v.push({ code: 'topic.openWithoutWindow', message: `open topic has no windowId`, id: t.id });
    }
    if (t.status === 'saved' && t.windowId !== undefined) {
      v.push({
        code: 'topic.savedWithWindow',
        message: `saved topic still has windowId`,
        id: t.id,
      });
    }
    if (t.status === 'open' && t.windowId !== undefined) {
      const other = windowSeen.get(t.windowId);
      if (other) {
        v.push({
          code: 'topic.duplicateWindow',
          message: `window ${t.windowId} mapped to topics ${other} and ${t.id}`,
          id: t.id,
        });
      } else {
        windowSeen.set(t.windowId, t.id);
      }
    }
    if (t.isNamed) {
      const key = topicNameKey(t.name);
      const other = nameSeen.get(key);
      if (other) {
        v.push({
          code: 'topic.duplicateName',
          message: `named topics share name "${t.name}": ${other}, ${t.id}`,
          id: t.id,
        });
      } else {
        nameSeen.set(key, t.id);
      }
    }
  }

  const subgroupById = new Map<string, Store['subgroups'][number]>();
  for (const g of store.subgroups) {
    subgroupById.set(g.id, g);
    if (!topicById.has(g.topicId)) {
      v.push({
        code: 'subgroup.orphanTopic',
        message: `subgroup ${g.id} → missing topic`,
        id: g.id,
      });
    }
  }

  const tabIds = new Set<string>();
  const chromeIds = new Map<number, string>();
  for (const tab of store.tabs) {
    if (tabIds.has(tab.id)) {
      v.push({ code: 'tab.duplicateId', message: `tab id duplicated: ${tab.id}`, id: tab.id });
      continue;
    }
    tabIds.add(tab.id);

    const topic = topicById.get(tab.topicId);
    if (!topic) {
      v.push({ code: 'tab.orphanTopic', message: `tab ${tab.id} → missing topic`, id: tab.id });
    } else if (tab.isOpen && topic.status !== 'open') {
      v.push({ code: 'tab.openInSavedTopic', message: `open tab in saved topic`, id: tab.id });
    }

    if (tab.isOpen && tab.chromeTabId === undefined) {
      v.push({
        code: 'tab.openWithoutChromeId',
        message: `open tab has no chromeTabId`,
        id: tab.id,
      });
    }
    if (!tab.isOpen && tab.chromeTabId !== undefined) {
      v.push({
        code: 'tab.closedWithChromeId',
        message: `closed tab keeps chromeTabId`,
        id: tab.id,
      });
    }
    if (tab.isOpen && tab.chromeTabId !== undefined) {
      const other = chromeIds.get(tab.chromeTabId);
      if (other) {
        v.push({
          code: 'tab.duplicateChromeId',
          message: `chromeTabId ${tab.chromeTabId} used by ${other} and ${tab.id}`,
          id: tab.id,
        });
      } else {
        chromeIds.set(tab.chromeTabId, tab.id);
      }
    }

    if (tab.subgroupId !== undefined) {
      const g = subgroupById.get(tab.subgroupId);
      if (!g) {
        v.push({ code: 'tab.orphanSubgroup', message: `tab → missing subgroup`, id: tab.id });
      } else if (g.topicId !== tab.topicId) {
        v.push({
          code: 'tab.subgroupTopicMismatch',
          message: `tab topic ${tab.topicId} ≠ subgroup topic ${g.topicId}`,
          id: tab.id,
        });
      }
    }
  }

  for (const r of store.rules) {
    if (!topicById.has(r.topicId)) {
      v.push({ code: 'rule.orphanTopic', message: `rule ${r.id} → missing topic`, id: r.id });
    }
  }

  return v;
}

export function assertInvariants(store: Store): void {
  const v = checkInvariants(store);
  if (v.length > 0) {
    throw new Error(
      `invariant violations:\n${v.map((x) => `  [${x.code}] ${x.message}`).join('\n')}`,
    );
  }
}
