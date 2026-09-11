import { beforeEach, describe, expect, it } from 'vitest';
import {
  SearchIndex,
  type SearchDoc,
  splitUrl,
  type TabDoc,
  type TopicDoc,
} from '../../../src/core/search/index';

const NOW = 1_700_000_000_000;
const H = 3_600_000;

function topic(id: string, name: string, over: Partial<TopicDoc> = {}): TopicDoc {
  return {
    kind: 'topic',
    id: `topic:${id}`,
    topicId: id,
    name,
    isNamed: true,
    status: 'open',
    windowId: Number(id.replace(/\D/g, '')) || 1,
    tabCount: 1,
    lastActiveAt: NOW - H,
    ...over,
  };
}

function tabDoc(
  id: string,
  topicId: string,
  topicName: string,
  title: string,
  url: string,
  over: Partial<TabDoc> = {},
): TabDoc {
  const { host, path } = splitUrl(url);
  return {
    kind: 'tab',
    id: `tab:${id}`,
    tabId: id,
    topicId,
    topicName,
    title,
    url,
    host,
    path,
    windowId: Number(topicId.replace(/\D/g, '')) || 1,
    chromeTabId: Number(id.replace(/\D/g, '')) || 1,
    isOpen: true,
    lastActiveAt: NOW - H,
    ...over,
  };
}

const DOCS: SearchDoc[] = [
  topic('t1', '프로젝트A'),
  topic('t2', '초록 대시보드'),
  topic('t3', 'Dev', { status: 'saved', windowId: undefined, lastActiveAt: NOW - 48 * H }),
  tabDoc(
    'a',
    't1',
    '프로젝트A',
    'GitHub - MacTechIN/chrome_tap_manager',
    'https://github.com/MacTechIN/chrome_tap_manager',
  ),
  tabDoc('b', 't1', '프로젝트A', '리액트 Hooks 가이드', 'https://ko.react.dev/reference/react'),
  tabDoc('c', 't2', '초록 대시보드', '챗봇 운영 대시보드', 'https://dashboard.example.com/bots'),
  tabDoc('d', 't2', '초록 대시보드', 'Grafana', 'https://grafana.internal/d/1'),
  tabDoc('e', 't3', 'Dev', 'Rust Book', 'https://doc.rust-lang.org/book/', {
    isOpen: false,
    chromeTabId: undefined,
    windowId: undefined,
    lastActiveAt: NOW - 48 * H,
  }),
];

const ids = (hits: { doc: SearchDoc }[]) => hits.map((h) => h.doc.id);

describe('SearchIndex', () => {
  let index: SearchIndex;
  beforeEach(() => {
    index = new SearchIndex();
    index.replaceAll(DOCS);
  });

  it('초성 "ㅊㄹ" finds 초록', () => {
    const hits = index.search({ text: 'ㅊㄹ', now: NOW });
    expect(ids(hits)[0]).toBe('topic:t2');
  });

  it('partial syllable "초ㄹ" finds 초록', () => {
    expect(ids(index.search({ text: '초ㄹ', now: NOW }))).toContain('topic:t2');
  });

  it('"gh" finds github.com', () => {
    const hits = index.search({ text: 'gh', now: NOW });
    expect(ids(hits)).toContain('tab:a');
    expect(ids(hits)[0]).toBe('tab:a');
  });

  it('typo tolerance on longer latin terms (edit distance 1)', () => {
    expect(ids(index.search({ text: 'githb', now: NOW }))).toContain('tab:a');
    expect(ids(index.search({ text: 'mannager', now: NOW }))).toContain('tab:a');
    expect(ids(index.search({ text: 'grafanna', now: NOW }))).toContain('tab:d');
  });

  it('mixed Korean + English "리액트 hooks"', () => {
    expect(ids(index.search({ text: '리액트 hooks', now: NOW }))[0]).toBe('tab:b');
  });

  it('exact topic name is ranked first even when tabs also match', () => {
    const hits = index.search({ text: '프로젝트A', now: NOW });
    expect(hits[0]!.doc.id).toBe('topic:t1');
    expect(ids(hits)).toContain('tab:a'); // tabs of that topic still listed (topicName field)
  });

  it('current window boost reorders equally matching tabs', () => {
    index.replaceAll([
      tabDoc('x', 't1', 'A', 'Notes', 'https://notes.app/1'),
      tabDoc('y', 't2', 'B', 'Notes', 'https://notes.app/2'),
    ]);
    expect(ids(index.search({ text: 'notes', currentWindowId: 2, now: NOW }))[0]).toBe('tab:y');
    expect(ids(index.search({ text: 'notes', currentWindowId: 1, now: NOW }))[0]).toBe('tab:x');
  });

  it('recency (MRU) breaks ties', () => {
    index.replaceAll([
      tabDoc('old', 't1', 'A', 'Same title', 'https://a.com/1', { lastActiveAt: NOW - 30 * H }),
      tabDoc('new', 't1', 'A', 'Same title', 'https://a.com/2', { lastActiveAt: NOW - 1 }),
    ]);
    expect(ids(index.search({ text: 'same', now: NOW }))[0]).toBe('tab:new');
  });

  it('scope: saved only / single topic', () => {
    expect(ids(index.search({ text: '', scope: { kind: 'saved' }, now: NOW }))).toEqual([
      'topic:t3',
      'tab:e',
    ]);
    const inT2 = index.search({ text: 'a', scope: { kind: 'topic', topicId: 't2' }, now: NOW });
    expect(inT2.every((h) => h.doc.topicId === 't2')).toBe(true);
  });

  it('empty query returns recent items, topics first among equals', () => {
    const hits = index.search({ text: '', now: NOW, limit: 3 });
    expect(hits).toHaveLength(3);
    expect(hits[0]!.doc.kind).toBe('topic');
  });

  it('upsert / remove keep the index consistent', () => {
    index.upsert(tabDoc('z', 't1', '프로젝트A', 'Zebra docs', 'https://zebra.dev/'));
    expect(ids(index.search({ text: 'zebra', now: NOW }))).toContain('tab:z');
    index.upsert(tabDoc('z', 't1', '프로젝트A', 'Renamed page', 'https://zebra.dev/'));
    expect(ids(index.search({ text: 'zebra docs', now: NOW }))).not.toContain('tab:z');
    expect(ids(index.search({ text: 'renamed', now: NOW }))).toContain('tab:z');
    index.remove('tab:z');
    expect(index.has('tab:z')).toBe(false);
    expect(ids(index.search({ text: 'renamed', now: NOW }))).not.toContain('tab:z');
  });

  it('splitUrl strips www and keeps path+query', () => {
    expect(splitUrl('https://www.github.com/a/b?x=1')).toEqual({
      host: 'github.com',
      path: '/a/b?x=1',
    });
    expect(splitUrl('not a url')).toEqual({ host: '', path: 'not a url' });
  });
});

describe('SearchIndex performance', () => {
  it('1,000 tabs + 100 topics: query under 10 ms (avg of warm runs)', () => {
    const docs: SearchDoc[] = [];
    const hosts = ['github.com', 'stackoverflow.com', 'ko.react.dev', 'notion.so', 'grafana.io'];
    const words = [
      '리액트',
      '초록',
      '대시보드',
      '가이드',
      '배포',
      'hooks',
      'router',
      'issue',
      'design',
      'rust',
    ];
    for (let t = 0; t < 100; t++) {
      docs.push(topic(`t${t}`, `${words[t % words.length]} 주제 ${t}`, { windowId: t }));
    }
    for (let i = 0; i < 1000; i++) {
      const t = i % 100;
      docs.push(
        tabDoc(
          `tab${i}`,
          `t${t}`,
          `${words[t % words.length]} 주제 ${t}`,
          `${words[i % words.length]} ${words[(i * 7) % words.length]} 문서 ${i}`,
          `https://${hosts[i % hosts.length]}/p/${i}`,
          { windowId: t },
        ),
      );
    }
    const index = new SearchIndex();
    const t0 = performance.now();
    index.replaceAll(docs);
    const buildMs = performance.now() - t0;
    expect(index.size).toBe(1100);

    const queries = ['ㅊㄹ', '초ㄹ', 'gh', '리액트 hooks', 'dashbord', '주제 4', 'grafana', 'rust'];
    for (const q of queries) index.search({ text: q, now: NOW }); // warm-up

    const t1 = performance.now();
    const rounds = 5;
    for (let r = 0; r < rounds; r++) for (const q of queries) index.search({ text: q, now: NOW });
    const avg = (performance.now() - t1) / (rounds * queries.length);

    console.log(`search bench: build ${buildMs.toFixed(1)} ms, avg query ${avg.toFixed(2)} ms`);
    expect(avg).toBeLessThan(10);
  });
});
