// core/search/fuzzy.ts — fzf-style subsequence matcher for short strings
// (topic names, hosts, titles). Complements MiniSearch: it catches abbreviations
// like "gh" → github.com and partial Hangul via jamo/초성 variants.
//
// Hot path: SearchIndex runs this over every entry per keystroke, so the query is
// prepared once (`prepareQuery`) and targets are pre-compacted at index time.

import { isChoseongQuery, normalizeText, queryToJamo, type TextVariants } from './hangul';

const WORD_START_BONUS = 2;
const CONSECUTIVE_BONUS = 1.5;
const PREFIX_BONUS = 1;
const GAP_PENALTY = 0.15;
const MAX_GAP_PENALTY = 3;

const SEPARATOR_CHAR = /[\s\p{P}\p{S}]/u;

function isSeparator(ch: string | undefined): boolean {
  return ch === undefined || SEPARATOR_CHAR.test(ch);
}

/**
 * Greedy in-order character match. Returns a positive score when every query
 * character appears in `target` in order, otherwise `undefined`.
 * Both inputs must already be normalized (lower-case).
 */
export function subsequenceScore(query: string, target: string): number | undefined {
  if (query.length === 0) return undefined;
  if (query.length > target.length) return undefined;

  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  let gapChars = 0;

  for (let qi = 0; qi < query.length; qi++) {
    const found = target.indexOf(query[qi]!, ti);
    if (found === -1) return undefined;

    score += 1;
    if (found === prevMatch + 1) score += CONSECUTIVE_BONUS;
    else if (isSeparator(target[found - 1])) score += WORD_START_BONUS;
    if (qi === 0 && found === 0) score += PREFIX_BONUS;

    gapChars += Math.max(0, found - ti);
    prevMatch = found;
    ti = found + 1;
  }

  score -= Math.min(MAX_GAP_PENALTY, gapChars * GAP_PENALTY);
  // Shorter targets are more specific matches.
  score -= Math.min(1, (target.length - query.length) / 200);
  return Math.max(0.01, score);
}

export type MatchVia = 'raw' | 'jamo' | 'cho';

export interface FuzzyMatch {
  score: number;
  via: MatchVia;
}

/** Space-less variants, precomputed at index time. */
export type CompactVariants = TextVariants;

export function compactVariants(v: TextVariants): CompactVariants {
  return {
    raw: v.raw.replace(/\s+/g, ''),
    jamo: v.jamo.replace(/\s+/g, ''),
    cho: v.cho.replace(/\s+/g, ''),
  };
}

export interface PreparedQuery {
  raw: string;
  /** Present when the query contains Hangul (syllables or jamo). */
  jamo?: string;
  /** Present when the query is bare initial consonants. */
  cho?: string;
}

export function prepareQuery(query: string): PreparedQuery | undefined {
  const raw = normalizeText(query).replace(/\s+/g, '');
  if (!raw) return undefined;
  const p: PreparedQuery = { raw };
  if (isChoseongQuery(raw)) p.cho = raw;
  if (/[가-힣ㄱ-ㆎ]/.test(raw)) p.jamo = queryToJamo(query).replace(/\s+/g, '');
  return p;
}

/** Best subsequence score of a prepared query against pre-compacted variants. */
export function matchPrepared(q: PreparedQuery, target: CompactVariants): FuzzyMatch | undefined {
  let best: FuzzyMatch | undefined;
  const consider = (score: number | undefined, via: MatchVia, weight: number) => {
    if (score === undefined) return;
    const s = score * weight;
    if (!best || s > best.score) best = { score: s, via };
  };
  consider(subsequenceScore(q.raw, target.raw), 'raw', 1);
  if (q.cho) consider(subsequenceScore(q.cho, target.cho), 'cho', 1.1);
  if (q.jamo) consider(subsequenceScore(q.jamo, target.jamo), 'jamo', 0.95);
  return best;
}

/** Convenience for one-off matches (command completion, tests). */
export function matchVariants(query: string, target: TextVariants): FuzzyMatch | undefined {
  const q = prepareQuery(query);
  return q ? matchPrepared(q, compactVariants(target)) : undefined;
}
