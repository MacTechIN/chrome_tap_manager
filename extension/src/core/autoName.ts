// core/autoName.ts — provisional Topic names for windows the user has not named.
// Spec F-01: one tab → its site; several → the most common host; none → "새 주제 N".

import { TOPIC_NAME_MAX, topicNameKey } from './model';

export const UNNAMED_PREFIX = '새 주제';

export interface NameSource {
  url: string;
  title: string;
}

/** Human-ish site label: host without "www.", or "scheme://host" for non-http schemes. */
export function siteName(url: string): string | undefined {
  const raw = url.trim();
  if (!raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    const host = u.hostname.replace(/^www\./, '');
    return host || undefined;
  }
  // chrome://extensions, file:///…, about:blank …
  if (u.protocol === 'about:') return undefined;
  const host = u.hostname || u.pathname.split('/').filter(Boolean)[0] || '';
  return host ? `${u.protocol}//${host}` : u.protocol;
}

function truncate(s: string, max = TOPIC_NAME_MAX): string {
  const t = s.normalize('NFC').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Smallest "새 주제 N" whose key is not already used. */
export function nextUnnamed(existingNames: Iterable<string>): string {
  const used = new Set<string>();
  for (const n of existingNames) used.add(topicNameKey(n));
  for (let i = 1; ; i++) {
    const candidate = `${UNNAMED_PREFIX} ${i}`;
    if (!used.has(topicNameKey(candidate))) return candidate;
  }
}

/**
 * Provisional name for a window from its tabs.
 * Returns `undefined` when no tab yields a usable label (caller keeps the placeholder).
 */
export function nameFromTabs(tabs: readonly NameSource[]): string | undefined {
  if (tabs.length === 0) return undefined;

  if (tabs.length === 1) {
    const t = tabs[0]!;
    const site = siteName(t.url);
    if (site) return truncate(site);
    const title = truncate(t.title);
    return title || undefined;
  }

  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const t of tabs) {
    const site = siteName(t.url);
    if (!site) continue;
    if (!counts.has(site)) order.push(site);
    counts.set(site, (counts.get(site) ?? 0) + 1);
  }
  if (order.length === 0) {
    const firstTitle = tabs.map((t) => truncate(t.title)).find((s) => s.length > 0);
    return firstTitle;
  }
  let best = order[0]!;
  for (const site of order) {
    if ((counts.get(site) ?? 0) > (counts.get(best) ?? 0)) best = site;
  }
  return truncate(best);
}

/** Full rule: tabs-derived name, else a fresh "새 주제 N". */
export function autoName(tabs: readonly NameSource[], existingNames: Iterable<string>): string {
  return nameFromTabs(tabs) ?? nextUnnamed(existingNames);
}
