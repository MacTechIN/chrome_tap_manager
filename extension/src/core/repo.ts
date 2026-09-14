// core/repo.ts — persistence layer over a tiny key-value abstraction.
// One key per collection so a mutation only rewrites the collection it touched.
// Backends: MemoryKV (tests) and chrome/storageKv.ts (chrome.storage.local).

import {
  COLLECTIONS,
  type CollectionName,
  emptyStore,
  type Meta,
  MOVE_LOG_LIMIT,
  type MoveLogEntry,
  type Rule,
  SCHEMA_VERSION,
  type Store,
  type Subgroup,
  type Tab,
  type Topic,
} from './model';

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryKV implements KeyValueStore {
  private map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    const v = this.map.get(key);
    // structuredClone so callers cannot mutate stored state by reference.
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  /** Test helper. */
  keys(): string[] {
    return [...this.map.keys()];
  }
}

export const KEY_PREFIX = 'ctm:';
export const META_KEY = `${KEY_PREFIX}meta`;
export const collectionKey = (c: CollectionName): string => `${KEY_PREFIX}${c}`;

export interface RepoOptions {
  now?: () => number;
  newId?: () => string;
}

export interface InitResult {
  schemaVersion: number;
  migrated: boolean;
  fresh: boolean;
}

type Migration = (store: Store) => Store;
/** index i migrates from version i+1 → i+2. */
const MIGRATIONS: Migration[] = [
  // v1 → v2: rules and move-log entries were keyed by topicId; they are now keyed by
  // topic name (topics die with their windows). Entries whose topic is gone are dropped.
  (store) => {
    const nameOf = new Map(store.topics.map((t) => [t.id, t.name] as const));
    type OldRule = Omit<Rule, 'topicName' | 'createdAt'> & {
      topicId?: string;
      topicName?: string;
      createdAt?: number;
    };
    type OldMove = Omit<MoveLogEntry, 'topicName'> & { topicId?: string; topicName?: string };
    const rules: Rule[] = [];
    for (const r of store.rules as unknown as OldRule[]) {
      const topicName = r.topicName ?? (r.topicId ? nameOf.get(r.topicId) : undefined);
      if (!topicName) continue;
      rules.push({
        id: r.id,
        topicName,
        kind: r.kind,
        pattern: r.pattern,
        priority: r.priority,
        source: r.source,
        enabled: r.enabled,
        undoCount: r.undoCount,
        createdAt: r.createdAt ?? 0,
      });
    }
    const moveLog: MoveLogEntry[] = [];
    for (const m of store.moveLog as unknown as OldMove[]) {
      const topicName = m.topicName ?? (m.topicId ? nameOf.get(m.topicId) : undefined);
      if (!topicName) continue;
      moveLog.push({
        id: m.id,
        host: m.host,
        pathPrefix: m.pathPrefix,
        topicName,
        movedAt: m.movedAt,
      });
    }
    return { ...store, rules, moveLog };
  },
];

export interface TabFilter {
  topicId?: string;
  isOpen?: boolean;
}

export class Repo {
  private cache: Store = emptyStore();
  private ready = false;
  private batchDepth = 0;
  private dirty = new Set<CollectionName>();
  readonly now: () => number;
  readonly newId: () => string;

  constructor(
    private readonly kv: KeyValueStore,
    opts: RepoOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.newId = opts.newId ?? (() => crypto.randomUUID());
  }

  // ---- lifecycle -------------------------------------------------------

  async init(): Promise<InitResult> {
    const meta = await this.kv.get<Meta>(META_KEY);
    // Always read the collections. A missing meta key must never wipe existing data
    // (e.g. a lost/partial write): treat "no meta but data present" as an old store
    // at the current schema and just (re)write the meta key.
    let store = await this.readAll();
    const hasData = COLLECTIONS.some((c) => store[c].length > 0);
    const fresh = meta === undefined && !hasData;
    if (fresh) store = emptyStore();
    let version = meta?.schemaVersion ?? SCHEMA_VERSION;
    let migrated = false;

    if (version > SCHEMA_VERSION) {
      throw new Error(`stored schema ${version} is newer than supported ${SCHEMA_VERSION}`);
    }
    while (version < SCHEMA_VERSION) {
      const m = MIGRATIONS[version - 1];
      if (!m) throw new Error(`no migration from schema ${version}`);
      store = m(store);
      version += 1;
      migrated = true;
    }

    this.cache = store;
    this.ready = true;
    if (fresh || migrated) {
      await this.writeAll();
    }
    if (fresh || migrated || meta === undefined) {
      await this.kv.set(META_KEY, { schemaVersion: SCHEMA_VERSION } satisfies Meta);
    }
    return { schemaVersion: SCHEMA_VERSION, migrated, fresh };
  }

  private assertReady(): void {
    if (!this.ready) throw new Error('Repo.init() must be awaited first');
  }

  private async readAll(): Promise<Store> {
    const store = emptyStore();
    for (const c of COLLECTIONS) {
      const v = await this.kv.get<Store[typeof c]>(collectionKey(c));
      if (v) (store[c] as unknown[]) = v;
    }
    return store;
  }

  private async writeAll(): Promise<void> {
    for (const c of COLLECTIONS) await this.flush(c);
  }

  private async flush(c: CollectionName): Promise<void> {
    if (this.batchDepth > 0) {
      this.dirty.add(c);
      return;
    }
    await this.kv.set(collectionKey(c), this.cache[c]);
  }

  /**
   * Runs `fn` with persistence deferred: every touched collection is written
   * once when the outermost batch completes. Nested batches are flattened.
   */
  async batch<T>(fn: () => Promise<T> | T): Promise<T> {
    this.batchDepth++;
    try {
      return await fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.dirty.size > 0) {
        const touched = [...this.dirty];
        this.dirty.clear();
        for (const c of touched) await this.kv.set(collectionKey(c), this.cache[c]);
      }
    }
  }

  /** Snapshot copy of the whole store (for search indexing, export, sync). */
  snapshot(): Store {
    this.assertReady();
    return structuredClone(this.cache);
  }

  /** Replace everything (import / full resync). */
  async replaceAll(store: Store): Promise<void> {
    this.assertReady();
    this.cache = structuredClone(store);
    await this.writeAll();
  }

  async clear(): Promise<void> {
    this.cache = emptyStore();
    await this.writeAll();
    await this.kv.set(META_KEY, { schemaVersion: SCHEMA_VERSION } satisfies Meta);
    this.ready = true;
  }

  // ---- topics ----------------------------------------------------------

  getTopic(id: string): Topic | undefined {
    this.assertReady();
    return this.cache.topics.find((t) => t.id === id);
  }

  listTopics(): Topic[] {
    this.assertReady();
    return [...this.cache.topics];
  }

  findTopicByWindow(windowId: number): Topic | undefined {
    this.assertReady();
    return this.cache.topics.find((t) => t.status === 'open' && t.windowId === windowId);
  }

  async putTopic(topic: Topic): Promise<Topic> {
    this.assertReady();
    upsert(this.cache.topics, topic);
    await this.flush('topics');
    return topic;
  }

  /** Deletes the topic and cascades to its tabs and subgroups (rules/move-log are by name). */
  async deleteTopic(id: string): Promise<boolean> {
    this.assertReady();
    const before = this.cache.topics.length;
    this.cache.topics = this.cache.topics.filter((t) => t.id !== id);
    if (this.cache.topics.length === before) return false;

    const touched: CollectionName[] = ['topics'];
    const tabs = this.cache.tabs.filter((t) => t.topicId !== id);
    if (tabs.length !== this.cache.tabs.length) {
      this.cache.tabs = tabs;
      touched.push('tabs');
    }
    const subgroups = this.cache.subgroups.filter((g) => g.topicId !== id);
    if (subgroups.length !== this.cache.subgroups.length) {
      this.cache.subgroups = subgroups;
      touched.push('subgroups');
    }
    // rules / moveLog are keyed by topic name and outlive the topic on purpose.

    for (const c of touched) await this.flush(c);
    return true;
  }

  // ---- tabs ------------------------------------------------------------

  getTab(id: string): Tab | undefined {
    this.assertReady();
    return this.cache.tabs.find((t) => t.id === id);
  }

  findTabByChromeId(chromeTabId: number): Tab | undefined {
    this.assertReady();
    return this.cache.tabs.find((t) => t.isOpen && t.chromeTabId === chromeTabId);
  }

  listTabs(filter: TabFilter = {}): Tab[] {
    this.assertReady();
    return this.cache.tabs.filter(
      (t) =>
        (filter.topicId === undefined || t.topicId === filter.topicId) &&
        (filter.isOpen === undefined || t.isOpen === filter.isOpen),
    );
  }

  async putTab(tab: Tab): Promise<Tab> {
    this.assertReady();
    upsert(this.cache.tabs, tab);
    await this.flush('tabs');
    return tab;
  }

  async putTabs(tabs: readonly Tab[]): Promise<void> {
    this.assertReady();
    for (const t of tabs) upsert(this.cache.tabs, t);
    await this.flush('tabs');
  }

  async deleteTab(id: string): Promise<boolean> {
    this.assertReady();
    const before = this.cache.tabs.length;
    this.cache.tabs = this.cache.tabs.filter((t) => t.id !== id);
    if (this.cache.tabs.length === before) return false;
    await this.flush('tabs');
    return true;
  }

  async deleteTabsByTopic(topicId: string): Promise<number> {
    this.assertReady();
    const before = this.cache.tabs.length;
    this.cache.tabs = this.cache.tabs.filter((t) => t.topicId !== topicId);
    const removed = before - this.cache.tabs.length;
    if (removed > 0) await this.flush('tabs');
    return removed;
  }

  // ---- subgroups -------------------------------------------------------

  listSubgroups(topicId?: string): Subgroup[] {
    this.assertReady();
    return this.cache.subgroups.filter((g) => topicId === undefined || g.topicId === topicId);
  }

  async putSubgroup(g: Subgroup): Promise<Subgroup> {
    this.assertReady();
    upsert(this.cache.subgroups, g);
    await this.flush('subgroups');
    return g;
  }

  async deleteSubgroup(id: string): Promise<boolean> {
    this.assertReady();
    const before = this.cache.subgroups.length;
    this.cache.subgroups = this.cache.subgroups.filter((g) => g.id !== id);
    if (this.cache.subgroups.length === before) return false;
    let tabsTouched = false;
    for (const t of this.cache.tabs) {
      if (t.subgroupId === id) {
        delete t.subgroupId;
        tabsTouched = true;
      }
    }
    await this.flush('subgroups');
    if (tabsTouched) await this.flush('tabs');
    return true;
  }

  // ---- rules -----------------------------------------------------------

  listRules(): Rule[] {
    this.assertReady();
    return [...this.cache.rules].sort((a, b) => a.priority - b.priority);
  }

  async putRule(r: Rule): Promise<Rule> {
    this.assertReady();
    upsert(this.cache.rules, r);
    await this.flush('rules');
    return r;
  }

  async deleteRule(id: string): Promise<boolean> {
    this.assertReady();
    const before = this.cache.rules.length;
    this.cache.rules = this.cache.rules.filter((r) => r.id !== id);
    if (this.cache.rules.length === before) return false;
    await this.flush('rules');
    return true;
  }

  // ---- move log --------------------------------------------------------

  listMoveLog(): MoveLogEntry[] {
    this.assertReady();
    return [...this.cache.moveLog];
  }

  /** Appends and trims to MOVE_LOG_LIMIT (oldest dropped). */
  async appendMoveLog(entry: MoveLogEntry): Promise<void> {
    this.assertReady();
    this.cache.moveLog.push(entry);
    if (this.cache.moveLog.length > MOVE_LOG_LIMIT) {
      this.cache.moveLog = this.cache.moveLog.slice(-MOVE_LOG_LIMIT);
    }
    await this.flush('moveLog');
  }
}

function upsert<T extends { id: string }>(arr: T[], item: T): void {
  const i = arr.findIndex((x) => x.id === item.id);
  if (i === -1) arr.push(item);
  else arr[i] = item;
}
