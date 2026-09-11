// core/model.ts — domain types. Pure data, no Chrome API.
// Mirrors docs/functional_spec.md §6.2 (v0.2, "one window = one topic").

export const SCHEMA_VERSION = 1;

/** Chrome tab-group palette (chrome.tabGroups.ColorEnum). */
export type TopicColor =
  'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

export type TopicStatus = 'open' | 'saved';

/**
 * A Topic is 1:1 with a normal Chrome window while `status === 'open'`.
 * When the window closes it becomes `saved` and keeps its tab list.
 */
export interface Topic {
  id: string;
  /** Display name. Auto-generated until the user renames it (`isNamed`). */
  name: string;
  isNamed: boolean;
  color?: TopicColor;
  description?: string;
  status: TopicStatus;
  /** Chrome windowId. Present iff `status === 'open'`. Volatile across restarts. */
  windowId?: number;
  browser: string;
  lastActiveAt: number;
  createdAt: number;
  updatedAt: number;
}

/** Every tab belongs to exactly one Topic (its window). */
export interface Tab {
  id: string;
  topicId: string;
  /** Stable identity across restarts: hash of normalized url + title. */
  fingerprint: string;
  url: string;
  title: string;
  favicon?: string;
  /** Chrome tabId. Present iff `isOpen`. Volatile across restarts. */
  chromeTabId?: number;
  subgroupId?: string;
  index: number;
  isOpen: boolean;
  lastActiveAt: number;
  updatedAt: number;
}

/** Optional Chrome Tab Group inside a Topic window. Never created by the extension itself. */
export interface Subgroup {
  id: string;
  topicId: string;
  name: string;
  color?: TopicColor;
  chromeGroupId?: number;
  collapsed: boolean;
}

export type RuleKind = 'host' | 'prefix' | 'regex';
export type RuleSource = 'learned' | 'manual';

export interface Rule {
  id: string;
  topicId: string;
  kind: RuleKind;
  pattern: string;
  priority: number;
  source: RuleSource;
  enabled: boolean;
  undoCount: number;
}

/** Recent "send tab to topic" actions, used to learn rule suggestions (F-10). */
export interface MoveLogEntry {
  id: string;
  host: string;
  pathPrefix: string;
  topicId: string;
  movedAt: number;
}

export const MOVE_LOG_LIMIT = 100;

export interface Store {
  topics: Topic[];
  tabs: Tab[];
  subgroups: Subgroup[];
  rules: Rule[];
  moveLog: MoveLogEntry[];
}

export type CollectionName = keyof Store;

export const COLLECTIONS: readonly CollectionName[] = [
  'topics',
  'tabs',
  'subgroups',
  'rules',
  'moveLog',
];

export function emptyStore(): Store {
  return { topics: [], tabs: [], subgroups: [], rules: [], moveLog: [] };
}

export interface Meta {
  schemaVersion: number;
}

export const TOPIC_NAME_MAX = 50;

/** Case-insensitive, whitespace-trimmed key used for name uniqueness. */
export function topicNameKey(name: string): string {
  return name.normalize('NFC').trim().toLocaleLowerCase();
}
