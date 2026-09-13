import { describe, expect, it } from 'vitest';
import {
  buildSuggestions,
  defaultDescription,
  encodeTarget,
  escapeXml,
  highlight,
  matchRanges,
  parseTarget,
  suggestionFor,
  targetOf,
} from '../../src/core/omniboxSuggest';
import type { SearchHit, TabDoc, TopicDoc } from '../../src/core/search/index';

const NOW = 1_700_000_000_000;

function topicHit(over: Partial<TopicDoc> = {}, score = 1): SearchHit {
  const doc: TopicDoc = {
    kind: 'topic',
    id: 'topic:t1',
    topicId: 't1',
    name: '프로젝트A',
    isNamed: true,
    status: 'open',
    windowId: 1,
    tabCount: 3,
    lastActiveAt: NOW,
    ...over,
  };
  return { doc, score };
}

function tabHit(over: Partial<TabDoc> = {}, score = 1): SearchHit {
  const doc: TabDoc = {
    kind: 'tab',
    id: 'tab:a',
    tabId: 'a',
    topicId: 't1',
    topicName: '프로젝트A',
    title: 'GitHub - MacTechIN/chrome_tap_manager',
    url: 'https://github.com/MacTechIN/chrome_tap_manager',
    host: 'github.com',
    path: '/MacTechIN/chrome_tap_manager',
    windowId: 1,
    chromeTabId: 10,
    isOpen: true,
    lastActiveAt: NOW,
    ...over,
  };
  return { doc, score };
}

describe('encode / parse target', () => {
  it('round-trips tab and topic targets', () => {
    const tab = { kind: 'tab', tabRowId: 'row-1' } as const;
    const topic = { kind: 'topic', topicId: 'abc-123' } as const;
    expect(parseTarget(encodeTarget(tab))).toEqual(tab);
    expect(parseTarget(encodeTarget(topic))).toEqual(topic);
    expect(encodeTarget(tab)).toBe('ctm:tab:row-1');
  });

  it('returns undefined for free text', () => {
    expect(parseTarget('github')).toBeUndefined();
    expect(parseTarget('ctm:other:1')).toBeUndefined();
    expect(parseTarget('')).toBeUndefined();
  });

  it('tolerates ids containing colons and surrounding spaces', () => {
    expect(parseTarget('  ctm:topic:a:b:c  ')).toEqual({ kind: 'topic', topicId: 'a:b:c' });
  });
});

describe('escapeXml / matchRanges / highlight', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;',
    );
  });

  it('finds case-insensitive token occurrences and merges overlaps', () => {
    expect(matchRanges('GitHub github', 'git')).toEqual([
      { start: 0, end: 3 },
      { start: 7, end: 10 },
    ]);
    expect(matchRanges('abcd', 'ab bc')).toEqual([{ start: 0, end: 3 }]);
    expect(matchRanges('nothing', 'zzz')).toEqual([]);
  });

  it('wraps matches and escapes around them', () => {
    expect(highlight('A & B git', 'git')).toBe('A &amp; B <match>git</match>');
    expect(highlight('<b>git</b>', 'git')).toBe('&lt;b&gt;<match>git</match>&lt;/b&gt;');
  });

  it('returns plain escaped text when nothing matches (e.g. 초성 query)', () => {
    expect(highlight('초록 대시보드', 'ㅊㄹ')).toBe('초록 대시보드');
  });

  it('highlights Korean tokens literally', () => {
    expect(highlight('리액트 Hooks 가이드', '리액트 hooks')).toBe(
      '<match>리액트</match> <match>Hooks</match> 가이드',
    );
  });
});

describe('suggestionFor', () => {
  it('topic: name + kind/tab count/state', () => {
    const s = suggestionFor(topicHit(), '프로젝트');
    expect(s.content).toBe('ctm:topic:t1');
    expect(s.description).toBe('<match>프로젝트</match>A <dim>— 주제 · 3탭 · 열림</dim>');
  });

  it('saved topic shows 저장됨', () => {
    const s = suggestionFor(topicHit({ status: 'saved', windowId: undefined }), '');
    expect(s.description).toContain('저장됨');
  });

  it('tab: title + host · topic in <url>', () => {
    const s = suggestionFor(tabHit(), 'github');
    expect(s.content).toBe('ctm:tab:a');
    expect(s.description).toBe(
      '<match>GitHub</match> - MacTechIN/chrome_tap_manager <dim>—</dim> ' +
        '<url><match>github</match>.com · 프로젝트A</url>',
    );
  });

  it('saved tab appends 저장됨; empty title falls back to the url', () => {
    const s = suggestionFor(tabHit({ isOpen: false, title: '' }), '');
    expect(s.description).toContain('저장됨');
    expect(s.description).toContain('https://github.com/MacTechIN/chrome_tap_manager');
  });

  it('truncates long titles', () => {
    const s = suggestionFor(tabHit({ title: 'x'.repeat(120) }), '');
    expect(s.description).toContain(`${'x'.repeat(69)}…`);
  });
});

describe('buildSuggestions / defaultDescription / targetOf', () => {
  it('keeps order, drops duplicate content, honours the limit', () => {
    const hits = [topicHit(), tabHit(), tabHit(), tabHit({ id: 'tab:b', tabId: 'b' })];
    const out = buildSuggestions(hits, '', 10);
    expect(out.map((s) => s.content)).toEqual(['ctm:topic:t1', 'ctm:tab:a', 'ctm:tab:b']);
    expect(buildSuggestions(hits, '', 2)).toHaveLength(2);
  });

  it('default suggestion reflects the typed text', () => {
    expect(defaultDescription('')).toContain('키워드를 입력하세요');
    expect(defaultDescription(' git ')).toBe('<match>git</match> <dim>— 탭·주제 검색</dim>');
    expect(defaultDescription('<x>')).toContain('&lt;x&gt;');
  });

  it('targetOf maps hits to focus targets', () => {
    expect(targetOf(topicHit())).toEqual({ kind: 'topic', topicId: 't1' });
    expect(targetOf(tabHit())).toEqual({ kind: 'tab', tabRowId: 'a' });
  });
});
