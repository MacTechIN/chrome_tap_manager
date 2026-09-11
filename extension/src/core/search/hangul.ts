// core/search/hangul.ts — text normalization and Hangul-aware variants.
// Every searchable string is indexed three ways:
//   raw  : NFC, lower-cased tokens            "리액트 hooks 가이드"
//   jamo : each Hangul token decomposed        "ㄹㅣㅇㅐㄱㅌㅡ hooks ㄱㅏㅇㅣㄷㅡ"  (partial syllables: "초ㄹ" → 초록)
//   cho  : each Hangul token's 초성 only        "ㄹㅇㅌ hooks ㄱㅇㄷ"                (initials: "ㅊㄹ" → 초록)
// Non-Hangul tokens are kept as-is in all three so mixed queries ("리액트 hooks") work.

import { disassemble, getChoseong } from 'es-hangul';

const HANGUL_SYLLABLE = /[가-힣]/;
/** Compatibility-jamo consonants ㄱ..ㅎ (what a Korean keyboard produces before a vowel). */
const CHOSEONG_ONLY = /^[ㄱ-ㅎ]+$/;
/** Token separators: whitespace, punctuation and symbols. Letters/digits of any script stay. */
const SEPARATOR = /[\s\p{P}\p{S}]+/u;

export function normalizeText(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(SEPARATOR)
    .filter((t) => t.length > 0);
}

export function hasHangul(s: string): boolean {
  return HANGUL_SYLLABLE.test(s);
}

/** True when the whole query is bare initial consonants, e.g. "ㅊㄹ". */
export function isChoseongQuery(s: string): boolean {
  return CHOSEONG_ONLY.test(s.replace(/\s+/g, ''));
}

export function tokenToJamo(token: string): string {
  return hasHangul(token) ? disassemble(token).toLowerCase() : token;
}

export function tokenToChoseong(token: string): string {
  if (!hasHangul(token)) return token;
  // getChoseong drops non-Hangul characters; keep them by mapping per character.
  let out = '';
  for (const ch of token) out += HANGUL_SYLLABLE.test(ch) ? getChoseong(ch) : ch;
  return out;
}

export interface TextVariants {
  raw: string;
  jamo: string;
  cho: string;
}

export function variants(text: string): TextVariants {
  const tokens = tokenize(text);
  return {
    raw: tokens.join(' '),
    jamo: tokens.map(tokenToJamo).join(' '),
    cho: tokens.map(tokenToChoseong).join(' '),
  };
}

/** Query-side jamo string: decompose Hangul tokens, keep the rest. */
export function queryToJamo(query: string): string {
  return tokenize(query).map(tokenToJamo).join(' ');
}
