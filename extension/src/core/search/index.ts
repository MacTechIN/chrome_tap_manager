// core/search/index.ts — SearchIndex over Topics and Tabs (spec F-07).
// Pure module: callers feed SearchDoc objects (built from Repo rows) and get ranked hits.
//
// Ranking = MiniSearch token score (prefix + typo tolerance, on raw/jamo/cho fields)
//         + fzf-style subsequence score (abbreviations like "gh" → github.com)
//         + boosts: exact topic-name match on top, current window, recency (MRU), open > saved.

import MiniSearch, { type SearchResult } from 'minisearch';
import { type CompactVariants, compactVariants, matchPrepared, prepareQuery } from './fuzzy';
import { isChoseongQuery, normalizeText, queryToJamo, variants } from './hangul';

export interface TopicDoc {
  kind: 'topic';
  id: string;
  topicId: string;
  name: string;
  isNamed: boolean;
  status: 'open' | 'saved';
  windowId?: number;
  tabCount: number;
  lastActiveAt: number;
  description?: string;
}

export interface TabDoc {
  kind: 'tab';
  id: string;
  tabId: string;
  topicId: string;
  topicName: string;
  title: string;
  url: string;
  host: string;
  path: string;
  windowId?: number;
  chromeTabId?: number;
  isOpen: boolean;
  lastActiveAt: number;
  favicon?: string;
  subgroupName?: string;
}

export type SearchDoc = TopicDoc | TabDoc;

/**
 * 'open'  — only live windows/tabs (default for the popup and omnibox)
 * 'saved' — only saved topics / closed tabs (`@saved`)
 * 'topic' — everything inside one topic (`#topic`)
 * 'all'   — no filter
 */
export type SearchScope =
  { kind: 'all' } | { kind: 'open' } | { kind: 'saved' } | { kind: 'topic'; topicId: string };

export interface SearchOptions {
  text: string;
  scope?: SearchScope;
  currentWindowId?: number;
  now?: number;
  limit?: number;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
}

interface IndexedDoc {
  id: string;
  name_raw: string;
  name_jamo: string;
  name_cho: string;
  title_raw: string;
  title_jamo: string;
  title_cho: string;
  host_raw: string;
  path_raw: string;
  topic_raw: string;
  topic_jamo: string;
  topic_cho: string;
  desc_raw: string;
}

interface Entry {
  doc: SearchDoc;
  /** Normalized (spaced) topic name / tab title — used for exact-match checks. */
  nameRaw: string;
  /** Pre-compacted variants for the fuzzy pass. */
  name: CompactVariants; // topic name (topic docs) / title (tab docs)
  host?: CompactVariants;
}

const RAW_FIELDS: (keyof IndexedDoc)[] = [
  'name_raw',
  'title_raw',
  'host_raw',
  'path_raw',
  'topic_raw',
  'desc_raw',
];
const JAMO_FIELDS: (keyof IndexedDoc)[] = ['name_jamo', 'title_jamo', 'topic_jamo'];
const CHO_FIELDS: (keyof IndexedDoc)[] = ['name_cho', 'title_cho', 'topic_cho'];
const ALL_FIELDS = [...RAW_FIELDS, ...JAMO_FIELDS, ...CHO_FIELDS];

const BOOST: Partial<Record<keyof IndexedDoc, number>> = {
  name_raw: 3,
  name_jamo: 3,
  name_cho: 3,
  host_raw: 2.5,
  title_raw: 2,
  title_jamo: 2,
  title_cho: 2,
  topic_raw: 1.2,
  topic_jamo: 1.2,
  topic_cho: 1.2,
  path_raw: 0.8,
  desc_raw: 0.8,
};

const W_TOKEN = 1.0;
const W_FUZZY = 0.8;
const B_EXACT_TOPIC = 100;
const B_TOPIC_KIND = 0.3;
const B_OPEN = 0.2;
const B_CURRENT_WINDOW = 0.5;
const B_RECENCY = 0.5;
const DEFAULT_LIMIT = 20;
const FUZZY_MAX_QUERY = 16;

export class SearchIndex {
  private mini: MiniSearch<IndexedDoc>;
  private entries = new Map<string, Entry>();

  constructor() {
    this.mini = SearchIndex.createMini();
  }

  private static createMini(): MiniSearch<IndexedDoc> {
    return new MiniSearch<IndexedDoc>({
      idField: 'id',
      fields: ALL_FIELDS,
      storeFields: [],
      searchOptions: { prefix: true },
    });
  }

  get size(): number {
    return this.entries.size;
  }

  replaceAll(docs: readonly SearchDoc[]): void {
    this.mini = SearchIndex.createMini();
    this.entries.clear();
    const indexed: IndexedDoc[] = [];
    for (const d of docs) indexed.push(this.register(d));
    this.mini.addAll(indexed);
  }

  upsert(doc: SearchDoc): void {
    if (this.entries.has(doc.id)) this.mini.discard(doc.id);
    this.mini.add(this.register(doc));
  }

  remove(id: string): void {
    if (!this.entries.has(id)) return;
    this.mini.discard(id);
    this.entries.delete(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  private register(doc: SearchDoc): IndexedDoc {
    if (doc.kind === 'topic') {
      const name = variants(doc.name);
      this.entries.set(doc.id, { doc, nameRaw: name.raw, name: compactVariants(name) });
      return {
        id: doc.id,
        name_raw: name.raw,
        name_jamo: name.jamo,
        name_cho: name.cho,
        title_raw: '',
        title_jamo: '',
        title_cho: '',
        host_raw: '',
        path_raw: '',
        topic_raw: '',
        topic_jamo: '',
        topic_cho: '',
        desc_raw: doc.description ? variants(doc.description).raw : '',
      };
    }
    const title = variants(doc.title);
    const host = variants(doc.host);
    const topicName = variants(doc.topicName);
    this.entries.set(doc.id, {
      doc,
      nameRaw: title.raw,
      name: compactVariants(title),
      host: compactVariants(host),
    });
    return {
      id: doc.id,
      name_raw: '',
      name_jamo: '',
      name_cho: '',
      title_raw: title.raw,
      title_jamo: title.jamo,
      title_cho: title.cho,
      host_raw: host.raw,
      path_raw: variants(doc.path).raw,
      topic_raw: topicName.raw,
      topic_jamo: topicName.jamo,
      topic_cho: topicName.cho,
      desc_raw: doc.subgroupName ? variants(doc.subgroupName).raw : '',
    };
  }

  search(opts: SearchOptions): SearchHit[] {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const now = opts.now ?? Date.now();
    const inScope = (d: SearchDoc) => scopeAllows(opts.scope ?? { kind: 'all' }, d);
    const q = normalizeText(opts.text);

    if (q.length === 0) {
      return this.recent(inScope, opts.currentWindowId, now, limit);
    }

    const scores = new Map<string, number>();
    const bump = (id: string, s: number) => scores.set(id, Math.max(scores.get(id) ?? 0, s));

    // 1) token search on raw fields (prefix + typo tolerance for longer terms)
    this.collect(
      this.mini.search(q, {
        fields: RAW_FIELDS,
        boost: BOOST,
        prefix: true,
        fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
        combineWith: 'AND',
      }),
      W_TOKEN,
      bump,
    );

    // 2) Hangul partial syllables → jamo fields; bare initials → cho fields
    const hasHangulChars = /[가-힣ㄱ-ㆎ]/.test(q);
    if (hasHangulChars) {
      if (isChoseongQuery(q)) {
        this.collect(
          this.mini.search(q, {
            fields: CHO_FIELDS,
            boost: BOOST,
            prefix: true,
            combineWith: 'AND',
          }),
          W_TOKEN,
          bump,
        );
      }
      const qj = queryToJamo(opts.text);
      if (qj) {
        this.collect(
          this.mini.search(qj, {
            fields: JAMO_FIELDS,
            boost: BOOST,
            prefix: true,
            combineWith: 'AND',
          }),
          W_TOKEN * 0.95,
          bump,
        );
      }
    }

    // 3) fzf-style subsequence on short fields (abbreviations, jamo, 초성).
    //    Query is prepared once; targets were compacted at index time.
    const prepared = q.length <= FUZZY_MAX_QUERY ? prepareQuery(q) : undefined;
    if (prepared) {
      let top = 0;
      const fuzzy = new Map<string, number>();
      for (const [id, e] of this.entries) {
        if (!inScope(e.doc)) continue;
        let best = 0;
        const m1 = matchPrepared(prepared, e.name);
        if (m1) best = m1.score;
        if (e.host) {
          const m2 = matchPrepared(prepared, e.host);
          if (m2 && m2.score * 0.9 > best) best = m2.score * 0.9;
        }
        if (best > 0) {
          fuzzy.set(id, best);
          if (best > top) top = best;
        }
      }
      if (top > 0) for (const [id, s] of fuzzy) bump(id, (s / top) * W_FUZZY);
    }

    // 4) boosts and ranking
    const hits: SearchHit[] = [];
    for (const [id, base] of scores) {
      const e = this.entries.get(id);
      if (!e || !inScope(e.doc)) continue;
      hits.push({ doc: e.doc, score: base + this.boosts(e, q, opts.currentWindowId, now) });
    }
    hits.sort((a, b) => b.score - a.score || tieBreak(a.doc, b.doc));
    return hits.slice(0, limit);
  }

  private collect(
    results: SearchResult[],
    weight: number,
    bump: (id: string, s: number) => void,
  ): void {
    if (results.length === 0) return;
    const top = results[0]!.score || 1;
    for (const r of results) bump(String(r.id), (r.score / top) * weight);
  }

  private boosts(e: Entry, q: string, currentWindowId: number | undefined, now: number): number {
    const d = e.doc;
    let b = 0;
    if (d.kind === 'topic') {
      b += B_TOPIC_KIND;
      if (e.nameRaw === q) b += B_EXACT_TOPIC;
      if (d.status === 'open') b += B_OPEN;
    } else if (d.isOpen) {
      b += B_OPEN;
    }
    if (currentWindowId !== undefined && d.windowId === currentWindowId) b += B_CURRENT_WINDOW;
    const hours = Math.max(0, now - d.lastActiveAt) / 3_600_000;
    b += B_RECENCY / (1 + hours);
    return b;
  }

  private recent(
    inScope: (d: SearchDoc) => boolean,
    currentWindowId: number | undefined,
    now: number,
    limit: number,
  ): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const e of this.entries.values()) {
      if (!inScope(e.doc)) continue;
      hits.push({ doc: e.doc, score: this.boosts(e, '', currentWindowId, now) });
    }
    hits.sort((a, b) => b.score - a.score || tieBreak(a.doc, b.doc));
    return hits.slice(0, limit);
  }
}

function scopeAllows(scope: SearchScope, d: SearchDoc): boolean {
  switch (scope.kind) {
    case 'all':
      return true;
    case 'open':
      return d.kind === 'topic' ? d.status === 'open' : d.isOpen;
    case 'saved':
      return d.kind === 'topic' ? d.status === 'saved' : !d.isOpen;
    case 'topic':
      return d.topicId === scope.topicId;
  }
}

function tieBreak(a: SearchDoc, b: SearchDoc): number {
  if (a.kind !== b.kind) return a.kind === 'topic' ? -1 : 1;
  return b.lastActiveAt - a.lastActiveAt;
}

/** Convenience for callers building TabDocs from URLs. */
export function splitUrl(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^www\./, ''), path: `${u.pathname}${u.search}` };
  } catch {
    return { host: '', path: url };
  }
}
