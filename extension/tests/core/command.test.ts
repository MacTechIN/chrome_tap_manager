import { describe, expect, it } from 'vitest';
import {
  findTopicByName,
  matchCommands,
  parseInput,
  rankTopics,
  suggestCommands,
  type TopicRef,
} from '../../src/core/command';

const TOPICS: TopicRef[] = [
  { id: 'a', name: '프로젝트A', status: 'open', windowId: 1 },
  { id: 'b', name: '초록 대시보드', status: 'open', windowId: 2 },
  { id: 'c', name: 'Dev', status: 'saved' },
  { id: 'd', name: 'Rust 학습', status: 'saved' },
];

describe('parseInput', () => {
  it('plain search', () => {
    expect(parseInput('  react hooks ')).toEqual({ mode: 'search', text: 'react hooks' });
  });

  it('@saved and #topic modes', () => {
    expect(parseInput('@saved rust')).toEqual({ mode: 'saved', text: 'rust' });
    expect(parseInput('#프로젝트A github')).toEqual({
      mode: 'topic',
      topicQuery: '프로젝트A',
      text: 'github',
    });
    expect(parseInput('#')).toEqual({ mode: 'topic', topicQuery: '', text: '' });
  });

  it('command mode: bare ">" / partial / resolved / with arg', () => {
    expect(parseInput('>')).toEqual({
      mode: 'command',
      command: undefined,
      partial: '',
      arg: '',
      hasSpace: false,
    });
    expect(parseInput('>mo')).toMatchObject({ command: undefined, partial: 'mo', hasSpace: false });
    expect(parseInput('>mo 프')).toMatchObject({ command: 'move', partial: 'mo', arg: '프' });
    expect(parseInput('>move  프로젝트A ')).toMatchObject({ command: 'move', arg: '프로젝트A' });
    expect(parseInput('>M')).toMatchObject({ command: undefined, partial: 'm' }); // move | merge
    expect(parseInput('>m x')).toMatchObject({ command: undefined, partial: 'm', arg: 'x' });
    expect(parseInput('>save')).toMatchObject({ command: 'save', arg: '' });
  });
});

describe('matchCommands / suggestCommands', () => {
  it('prefix completion', () => {
    expect(matchCommands('')).toHaveLength(7);
    expect(matchCommands('m')).toEqual(['move', 'merge']);
    expect(matchCommands('re')).toEqual(['rename']);
    expect(matchCommands('zz')).toEqual([]);
  });

  it('">" lists all commands; ">mo" narrows', () => {
    const all = suggestCommands(parseInput('>') as never, TOPICS);
    expect(all.map((s) => s.command)).toEqual([
      'move',
      'new',
      'rename',
      'open',
      'close',
      'save',
      'merge',
    ]);
    expect(all.find((s) => s.command === 'save')!.complete).toBe(true);
    expect(all.find((s) => s.command === 'move')!.complete).toBe(false);

    const mo = suggestCommands(parseInput('>mo') as never, TOPICS);
    expect(mo.map((s) => s.command)).toEqual(['move']);
    expect(mo[0]!.fill).toBe('>move ');
  });

  it('">mo 프" → move 프로젝트A (Hangul-aware topic completion)', () => {
    const s = suggestCommands(parseInput('>mo 프') as never, TOPICS);
    expect(s[0]).toMatchObject({ command: 'move', topic: { id: 'a' }, complete: true });
    expect(s[0]!.fill).toBe('>move 프로젝트A');
  });

  it('">move ㅊㄹ" → 초록 대시보드 via 초성; excludes the current topic', () => {
    const s = suggestCommands(parseInput('>move ㅊㄹ') as never, TOPICS, { currentTopicId: 'b' });
    expect(s.find((x) => x.topic?.id === 'b')).toBeUndefined();
    const s2 = suggestCommands(parseInput('>move ㅊㄹ') as never, TOPICS, { currentTopicId: 'a' });
    expect(s2[0]!.topic?.id).toBe('b');
  });

  it('">open" offers saved topics only', () => {
    const s = suggestCommands(parseInput('>open ') as never, TOPICS);
    expect(s.map((x) => x.topic?.id)).toEqual(['c', 'd']);
    expect(s[0]!.description).toContain('저장됨');
  });

  it('">close" offers current window first, then topics', () => {
    const s = suggestCommands(parseInput('>close ') as never, TOPICS);
    expect(s[0]).toMatchObject({ command: 'close', complete: true, fill: '>close' });
    expect(s[1]!.topic).toBeDefined();
  });

  it('">new 이름" / ">rename" are complete only with a name', () => {
    expect(suggestCommands(parseInput('>new ') as never, TOPICS)[0]!.complete).toBe(false);
    expect(suggestCommands(parseInput('>new 새 작업') as never, TOPICS)[0]).toMatchObject({
      arg: '새 작업',
      complete: true,
      fill: '>new 새 작업',
    });
  });
});

describe('rankTopics / findTopicByName', () => {
  it('ranks by fuzzy Hangul-aware match, empty query keeps order', () => {
    expect(rankTopics('', TOPICS).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rankTopics('rs', TOPICS).map((t) => t.id)).toEqual(['d']);
    expect(rankTopics('ㄷㅅㅂㄷ', TOPICS)[0]!.id).toBe('b');
  });

  it('findTopicByName is case/space-insensitive', () => {
    expect(findTopicByName(' dev ', TOPICS)?.id).toBe('c');
    expect(findTopicByName('DEV', TOPICS)?.id).toBe('c');
    expect(findTopicByName('nope', TOPICS)).toBeUndefined();
  });
});
