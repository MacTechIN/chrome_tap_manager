import { describe, expect, it } from 'vitest';
import type { MoveLogEntry, Rule } from '../../src/core/model';
import { SUGGEST_WINDOW_MS, suggestRules } from '../../src/core/ruleSuggest';

const NOW = 1_700_000_000_000;

function move(host: string, topicName: string, pathPrefix = '/', ago = 1_000): MoveLogEntry {
  return { id: `${host}-${Math.random()}`, host, pathPrefix, topicName, movedAt: NOW - ago };
}

function suggest(moveLog: MoveLogEntry[], over: Partial<Parameters<typeof suggestRules>[0]> = {}) {
  return suggestRules({
    moveLog,
    rules: [],
    dismissed: new Set(),
    openTopicNames: ['Dev', 'Docs'],
    now: NOW,
    ...over,
  });
}

describe('suggestRules', () => {
  it('needs two moves of the same host to the same topic', () => {
    expect(suggest([move('github.com', 'Dev')])).toEqual([]);
    const s = suggest([move('github.com', 'Dev'), move('github.com', 'Dev')]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: 'host', pattern: 'github.com', topicName: 'Dev', moves: 2 });
  });

  it('suggests a prefix rule when every move shares a non-root path segment', () => {
    const s = suggest([
      move('github.com', 'Dev', '/MacTechIN'),
      move('github.com', 'Dev', '/MacTechIN'),
    ]);
    expect(s[0]).toMatchObject({ kind: 'prefix', pattern: 'github.com/MacTechIN' });
    const mixed = suggest([move('github.com', 'Dev', '/a'), move('github.com', 'Dev', '/b')]);
    expect(mixed[0]).toMatchObject({ kind: 'host', pattern: 'github.com' });
  });

  it('ignores old moves, closed topics, dismissed keys and already-covered patterns', () => {
    const old = suggest([
      move('github.com', 'Dev', '/', SUGGEST_WINDOW_MS + 1),
      move('github.com', 'Dev'),
    ]);
    expect(old).toEqual([]);

    expect(suggest([move('x.com', 'Gone'), move('x.com', 'Gone')])).toEqual([]);

    const dismissed = suggest([move('github.com', 'Dev'), move('github.com', 'Dev')], {
      dismissed: new Set(['host|github.com|dev']),
    });
    expect(dismissed).toEqual([]);

    const covering: Rule = {
      id: 'r',
      topicName: 'dev',
      kind: 'host',
      pattern: 'github.com',
      priority: 100,
      source: 'manual',
      enabled: true,
      undoCount: 0,
      createdAt: 0,
    };
    expect(
      suggest([move('github.com', 'Dev'), move('github.com', 'Dev')], { rules: [covering] }),
    ).toEqual([]);
    // a disabled rule does not count as coverage
    expect(
      suggest([move('github.com', 'Dev'), move('github.com', 'Dev')], {
        rules: [{ ...covering, enabled: false }],
      }),
    ).toHaveLength(1);
  });

  it('orders by move count, then recency', () => {
    const s = suggest([
      move('a.com', 'Dev'),
      move('a.com', 'Dev'),
      move('b.com', 'Docs', '/', 10),
      move('b.com', 'Docs', '/', 20),
      move('b.com', 'Docs', '/', 30),
    ]);
    expect(s.map((x) => x.pattern)).toEqual(['b.com', 'a.com']);
  });
});
