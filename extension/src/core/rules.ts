// core/rules.ts — URL rules (spec F-10): host / path-prefix / regex → topic name.
// Pure: evaluation takes the rule list and a resolver for "open topic named X".

import { type Rule, type RuleKind, type Topic, topicNameKey } from './model';

export interface UrlParts {
  host: string;
  /** First path segment, e.g. "/MacTechIN"; "/" when none. */
  pathPrefix: string;
  /** host + pathname, used for prefix rules ("github.com/MacTechIN"). */
  hostPath: string;
}

/** Only http(s) pages are routable; everything else returns undefined. */
export function urlParts(url: string): UrlParts | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (!host) return undefined;
  const seg = u.pathname.split('/').filter(Boolean)[0];
  const pathPrefix = seg ? `/${seg}` : '/';
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '';
  return { host, pathPrefix, hostPath: `${host}${path}` };
}

const regexCache = new Map<string, RegExp | null>();
function compile(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;
  let re: RegExp | null;
  try {
    re = new RegExp(pattern, 'i');
  } catch {
    re = null;
  }
  regexCache.set(pattern, re);
  return re;
}

export function normalizePattern(kind: RuleKind, raw: string): string {
  const p = raw.trim();
  if (kind === 'regex') return p;
  // Accept full URLs or bare host[/path]; store lower-cased host without scheme/www.
  const stripped = p.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '');
  const noSlash = stripped.replace(/\/+$/, '');
  if (kind === 'host') return noSlash.split('/')[0]!.toLowerCase();
  const [host, ...rest] = noSlash.split('/');
  return [host!.toLowerCase(), ...rest].join('/');
}

export function matchRule(rule: Pick<Rule, 'kind' | 'pattern'>, url: string): boolean {
  const parts = urlParts(url);
  if (!parts) return false;
  switch (rule.kind) {
    case 'host': {
      const p = rule.pattern.toLowerCase();
      return parts.host === p || parts.host.endsWith(`.${p}`);
    }
    case 'prefix': {
      const p = rule.pattern.toLowerCase();
      return parts.hostPath.toLowerCase() === p || parts.hostPath.toLowerCase().startsWith(`${p}/`);
    }
    case 'regex': {
      const re = compile(rule.pattern);
      return re ? re.test(url) : false;
    }
  }
}

export interface RuleDecision {
  rule: Rule;
  topic: Topic & { windowId: number };
}

/**
 * First enabled rule (by priority, then creation order) that matches `url` AND whose
 * topic is currently open. Rules for closed topics are skipped, not errors.
 */
export function evaluate(
  rules: readonly Rule[],
  url: string,
  resolveTopic: (topicNameKey: string) => (Topic & { windowId: number }) | undefined,
): RuleDecision | undefined {
  if (!urlParts(url)) return undefined;
  const ordered = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  for (const rule of ordered) {
    if (!matchRule(rule, url)) continue;
    const topic = resolveTopic(topicNameKey(rule.topicName));
    if (topic) return { rule, topic };
  }
  return undefined;
}

/** Build a resolver over the current topic list (open topics only). */
export function openTopicResolver(topics: readonly Topic[]) {
  const byKey = new Map<string, Topic & { windowId: number }>();
  for (const t of topics) {
    if (t.status === 'open' && t.windowId !== undefined) {
      byKey.set(topicNameKey(t.name), t as Topic & { windowId: number });
    }
  }
  return (key: string) => byKey.get(key);
}

/** Stable identity of a rule's intent, used to de-duplicate suggestions and rules. */
export function ruleKey(kind: RuleKind, pattern: string, topicName: string): string {
  return `${kind}|${pattern.toLowerCase()}|${topicNameKey(topicName)}`;
}

export function makeRule(
  input: {
    kind: RuleKind;
    pattern: string;
    topicName: string;
    source?: Rule['source'];
    priority?: number;
  },
  ids: { newId: () => string; now: () => number },
): Rule {
  return {
    id: ids.newId(),
    topicName: input.topicName.trim(),
    kind: input.kind,
    pattern: normalizePattern(input.kind, input.pattern),
    priority: input.priority ?? 100,
    source: input.source ?? 'manual',
    enabled: true,
    undoCount: 0,
    createdAt: ids.now(),
  };
}
