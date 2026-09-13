// core/omniboxSuggest.ts — turns SearchHits into omnibox suggestions (spec F-11).
// Pure: no Chrome. The adapter in chrome/omnibox.ts feeds it search results.
//
// Chrome renders suggestion descriptions as a tiny XML dialect: <match>, <dim>, <url>.
// Text must therefore be escaped, and highlight tags inserted around escaped segments.

import { tokenize } from './search/hangul';
import type { SearchHit } from './search/index';

export const OMNIBOX_KEYWORD = 't';
export const OMNIBOX_LIMIT = 6;

export type OmniboxTarget = { kind: 'tab'; tabRowId: string } | { kind: 'topic'; topicId: string };

export interface OmniboxSuggestion {
  /** Machine-readable token Chrome hands back on selection. */
  content: string;
  /** XML-ish markup shown in the dropdown. */
  description: string;
}

const CONTENT_PREFIX = 'ctm:';

export function encodeTarget(target: OmniboxTarget): string {
  return target.kind === 'tab'
    ? `${CONTENT_PREFIX}tab:${target.tabRowId}`
    : `${CONTENT_PREFIX}topic:${target.topicId}`;
}

export function parseTarget(content: string): OmniboxTarget | undefined {
  const m = /^ctm:(tab|topic):(.+)$/.exec(content.trim());
  if (!m) return undefined;
  return m[1] === 'tab' ? { kind: 'tab', tabRowId: m[2]! } : { kind: 'topic', topicId: m[2]! };
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface Range {
  start: number;
  end: number;
}

/** Literal, case-insensitive occurrences of each query token, merged. */
export function matchRanges(text: string, query: string): Range[] {
  const haystack = text.toLowerCase();
  const ranges: Range[] = [];
  for (const token of tokenize(query)) {
    if (token.length === 0) continue;
    let from = 0;
    for (;;) {
      const i = haystack.indexOf(token, from);
      if (i === -1) break;
      ranges.push({ start: i, end: i + token.length });
      from = i + token.length;
    }
  }
  if (ranges.length === 0) return ranges;
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [ranges[0]!];
  for (const r of ranges.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push(r);
  }
  return merged;
}

/** Escaped text with <match> around literal query hits. */
export function highlight(text: string, query: string): string {
  const ranges = matchRanges(text, query);
  if (ranges.length === 0) return escapeXml(text);
  let out = '';
  let cursor = 0;
  for (const r of ranges) {
    out += escapeXml(text.slice(cursor, r.start));
    out += `<match>${escapeXml(text.slice(r.start, r.end))}</match>`;
    cursor = r.end;
  }
  return out + escapeXml(text.slice(cursor));
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function suggestionFor(hit: SearchHit, query: string): OmniboxSuggestion {
  const d = hit.doc;
  if (d.kind === 'topic') {
    const state = d.status === 'open' ? '열림' : '저장됨';
    return {
      content: encodeTarget({ kind: 'topic', topicId: d.topicId }),
      description:
        `${highlight(truncate(d.name, 60), query)} ` +
        `<dim>— 주제 · ${d.tabCount}탭 · ${state}</dim>`,
    };
  }
  const title = truncate(d.title || d.url, 70);
  const where = [d.host, d.topicName].filter(Boolean).map((s) => truncate(s, 30));
  if (!d.isOpen) where.push('저장됨');
  return {
    content: encodeTarget({ kind: 'tab', tabRowId: d.tabId }),
    description: `${highlight(title, query)} <dim>—</dim> <url>${highlight(where.join(' · '), query)}</url>`,
  };
}

export function buildSuggestions(
  hits: readonly SearchHit[],
  query: string,
  limit = OMNIBOX_LIMIT,
): OmniboxSuggestion[] {
  const out: OmniboxSuggestion[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const s = suggestionFor(hit, query);
    if (seen.has(s.content)) continue; // Chrome drops duplicate content
    seen.add(s.content);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export function defaultDescription(query: string): string {
  const q = query.trim();
  return q.length === 0
    ? '탭·주제 검색 <dim>— 키워드를 입력하세요</dim>'
    : `<match>${escapeXml(truncate(q, 60))}</match> <dim>— 탭·주제 검색</dim>`;
}

export function targetOf(hit: SearchHit): OmniboxTarget {
  return hit.doc.kind === 'topic'
    ? { kind: 'topic', topicId: hit.doc.topicId }
    : { kind: 'tab', tabRowId: hit.doc.tabId };
}
