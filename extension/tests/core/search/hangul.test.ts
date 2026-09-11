import { describe, expect, it } from 'vitest';
import {
  isChoseongQuery,
  normalizeText,
  queryToJamo,
  tokenize,
  tokenToChoseong,
  tokenToJamo,
  variants,
} from '../../../src/core/search/hangul';

describe('normalizeText / tokenize', () => {
  it('NFC, lower-case, whitespace collapse', () => {
    expect(normalizeText('  GitHub   Docs ')).toBe('github docs');
    expect(normalizeText('한글'.normalize('NFD'))).toBe('한글');
  });

  it('splits on whitespace, punctuation and symbols; keeps letters/digits of any script', () => {
    expect(tokenize('github.com/MacTechIN/chrome_tap_manager?x=1')).toEqual([
      'github',
      'com',
      'mactechin',
      'chrome',
      'tap',
      'manager',
      'x',
      '1',
    ]);
    expect(tokenize('리액트 · Hooks — 가이드!')).toEqual(['리액트', 'hooks', '가이드']);
  });
});

describe('jamo / 초성', () => {
  it('decomposes Hangul tokens and leaves others alone', () => {
    expect(tokenToJamo('초록')).toBe('ㅊㅗㄹㅗㄱ');
    expect(tokenToJamo('hooks')).toBe('hooks');
  });

  it('초성 per character, keeping non-Hangul characters inside a token', () => {
    expect(tokenToChoseong('초록')).toBe('ㅊㄹ');
    expect(tokenToChoseong('챗gpt봇')).toBe('ㅊgptㅂ');
    expect(tokenToChoseong('github')).toBe('github');
  });

  it('variants gives raw / jamo / cho with non-Hangul tokens preserved', () => {
    expect(variants('리액트 Hooks 가이드')).toEqual({
      raw: '리액트 hooks 가이드',
      jamo: 'ㄹㅣㅇㅐㄱㅌㅡ hooks ㄱㅏㅇㅣㄷㅡ',
      cho: 'ㄹㅇㅌ hooks ㄱㅇㄷ',
    });
  });

  it('isChoseongQuery only for bare initial consonants', () => {
    expect(isChoseongQuery('ㅊㄹ')).toBe(true);
    expect(isChoseongQuery('ㅊ ㄹ')).toBe(true);
    expect(isChoseongQuery('초ㄹ')).toBe(false);
    expect(isChoseongQuery('ㅏ')).toBe(false);
    expect(isChoseongQuery('gh')).toBe(false);
  });

  it('queryToJamo decomposes partial syllables', () => {
    expect(queryToJamo('초ㄹ')).toBe('ㅊㅗㄹ');
    expect(queryToJamo('리액트 hooks')).toBe('ㄹㅣㅇㅐㄱㅌㅡ hooks');
  });
});
