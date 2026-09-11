import { describe, expect, it } from 'vitest';
import { matchVariants, subsequenceScore } from '../../../src/core/search/fuzzy';
import { variants } from '../../../src/core/search/hangul';

describe('subsequenceScore', () => {
  it('requires every query char in order', () => {
    expect(subsequenceScore('gh', 'github')).toBeGreaterThan(0);
    expect(subsequenceScore('hg', 'github')).toBeUndefined();
    expect(subsequenceScore('', 'x')).toBeUndefined();
    expect(subsequenceScore('toolong', 'to')).toBeUndefined();
  });

  it('prefers prefix and word-start matches over scattered ones', () => {
    const prefix = subsequenceScore('git', 'github.com')!;
    const scattered = subsequenceScore('git', 'digit-hub')!;
    expect(prefix).toBeGreaterThan(scattered);
  });

  it('prefers shorter, tighter targets', () => {
    expect(subsequenceScore('dev', 'dev')!).toBeGreaterThan(
      subsequenceScore('dev', 'developer.mozilla.org')!,
    );
  });
});

describe('matchVariants', () => {
  it('초성 query matches via cho variant', () => {
    const m = matchVariants('ㅊㄹ', variants('초록'));
    expect(m?.via).toBe('cho');
  });

  it('partial syllable query matches via jamo variant', () => {
    const m = matchVariants('초ㄹ', variants('초록 프로젝트'));
    expect(m).toBeDefined();
    expect(['jamo', 'raw']).toContain(m!.via);
  });

  it('latin abbreviation matches raw', () => {
    expect(matchVariants('gh', variants('github.com'))?.via).toBe('raw');
    expect(matchVariants('zzz', variants('github.com'))).toBeUndefined();
  });

  it('mixed Hangul + latin query', () => {
    expect(matchVariants('리액트hooks', variants('리액트 Hooks 가이드'))).toBeDefined();
  });
});
