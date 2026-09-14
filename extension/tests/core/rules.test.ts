import { describe, expect, it } from 'vitest';
import type { Rule, Topic } from '../../src/core/model';
import {
  evaluate,
  makeRule,
  matchRule,
  normalizePattern,
  openTopicResolver,
  ruleKey,
  urlParts,
} from '../../src/core/rules';

const ids = { newId: () => 'r', now: () => 1_000 };

function rule(over: Partial<Rule>): Rule {
  return {
    id: 'r1',
    topicName: 'Dev',
    kind: 'host',
    pattern: 'github.com',
    priority: 100,
    source: 'manual',
    enabled: true,
    undoCount: 0,
    createdAt: 1,
    ...over,
  };
}

function topic(
  name: string,
  windowId: number | undefined,
  status: Topic['status'] = 'open',
): Topic {
  return {
    id: `t-${name}`,
    name,
    isNamed: true,
    status,
    windowId,
    browser: 'chrome',
    lastActiveAt: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('urlParts / normalizePattern', () => {
  it('splits http(s) urls; rejects other schemes', () => {
    expect(urlParts('https://www.GitHub.com/MacTechIN/repo/issues?x=1')).toEqual({
      host: 'github.com',
      pathPrefix: '/MacTechIN',
      hostPath: 'github.com/MacTechIN/repo/issues',
    });
    expect(urlParts('https://example.com/')).toEqual({
      host: 'example.com',
      pathPrefix: '/',
      hostPath: 'example.com',
    });
    expect(urlParts('chrome://extensions/')).toBeUndefined();
    expect(urlParts('not a url')).toBeUndefined();
  });

  it('normalizes patterns typed as urls or bare hosts', () => {
    expect(normalizePattern('host', 'https://www.GitHub.com/x/')).toBe('github.com');
    expect(normalizePattern('prefix', 'https://GitHub.com/MacTechIN/')).toBe(
      'github.com/MacTechIN',
    );
    expect(normalizePattern('regex', ' ^https://a\\.com ')).toBe('^https://a\\.com');
  });
});

describe('matchRule', () => {
  it('host matches the host and its subdomains only', () => {
    const r = rule({ kind: 'host', pattern: 'github.com' });
    expect(matchRule(r, 'https://github.com/a')).toBe(true);
    expect(matchRule(r, 'https://gist.github.com/a')).toBe(true);
    expect(matchRule(r, 'https://notgithub.com/a')).toBe(false);
    expect(matchRule(r, 'file:///C:/github.com')).toBe(false);
  });

  it('prefix matches host+path boundaries', () => {
    const r = rule({ kind: 'prefix', pattern: 'github.com/MacTechIN' });
    expect(matchRule(r, 'https://github.com/MacTechIN')).toBe(true);
    expect(matchRule(r, 'https://github.com/MacTechIN/repo')).toBe(true);
    expect(matchRule(r, 'https://github.com/MacTechINx/repo')).toBe(false);
    expect(matchRule(r, 'https://github.com/other')).toBe(false);
  });

  it('regex matches the full url (case-insensitive); invalid regex never matches', () => {
    expect(
      matchRule(rule({ kind: 'regex', pattern: 'issues/\\d+$' }), 'https://x.dev/issues/42'),
    ).toBe(true);
    expect(matchRule(rule({ kind: 'regex', pattern: '[' }), 'https://x.dev/')).toBe(false);
  });
});

describe('evaluate', () => {
  const resolver = openTopicResolver([
    topic('Dev', 10),
    topic('Docs', 20),
    topic('Closed', undefined, 'saved'),
  ]);

  it('picks the first enabled matching rule whose topic is open, by priority then age', () => {
    const rules = [
      rule({ id: 'late', pattern: 'github.com', topicName: 'Docs', priority: 50, createdAt: 9 }),
      rule({ id: 'early', pattern: 'github.com', topicName: 'Dev', priority: 50, createdAt: 1 }),
      rule({ id: 'high', pattern: 'github.com', topicName: 'Docs', priority: 200 }),
    ];
    const d = evaluate(rules, 'https://github.com/x', resolver)!;
    expect(d.rule.id).toBe('early');
    expect(d.topic.windowId).toBe(10);
  });

  it('skips disabled rules and rules for closed topics; non-http urls never match', () => {
    const rules = [
      rule({ id: 'off', enabled: false }),
      rule({ id: 'closed', topicName: 'Closed' }),
      rule({ id: 'ok', topicName: 'Docs' }),
    ];
    expect(evaluate(rules, 'https://github.com/x', resolver)!.rule.id).toBe('ok');
    expect(evaluate(rules, 'chrome://extensions/', resolver)).toBeUndefined();
    expect(evaluate([], 'https://github.com/x', resolver)).toBeUndefined();
  });

  it('resolves topic names case/space-insensitively', () => {
    const r = openTopicResolver([topic(' Dev ', 10)]);
    expect(evaluate([rule({ topicName: 'dev' })], 'https://github.com/', r)!.topic.windowId).toBe(
      10,
    );
  });

  it('100 rules × one evaluation stays well under 1 ms on average', () => {
    const rules = Array.from({ length: 100 }, (_, i) =>
      rule({ id: `r${i}`, pattern: `site${i}.com`, priority: i }),
    );
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) evaluate(rules, 'https://site99.com/page', resolver);
    const avg = (performance.now() - t0) / 1000;
    expect(avg).toBeLessThan(1);
  });
});

describe('makeRule / ruleKey', () => {
  it('normalizes and stamps', () => {
    const r = makeRule({ kind: 'host', pattern: 'https://www.A.com/', topicName: ' Dev ' }, ids);
    expect(r).toMatchObject({
      id: 'r',
      pattern: 'a.com',
      topicName: 'Dev',
      enabled: true,
      undoCount: 0,
      priority: 100,
      source: 'manual',
      createdAt: 1_000,
    });
    expect(ruleKey('host', 'A.com', ' dev ')).toBe('host|a.com|dev');
  });
});
