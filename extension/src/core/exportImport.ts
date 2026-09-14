// core/exportImport.ts — JSON backup / restore (spec F-12, F-15).
// Export carries rules + settings (the durable user data) plus a read-only snapshot of the
// open topics with their tab URLs. Import merges rules (de-duplicated by intent) and settings;
// topics are not imported because a topic only exists while its window is open (v0.3).

import { type Rule, type RuleKind, type Store, TOPIC_NAME_MAX } from './model';
import type { Repo } from './repo';
import { makeRule, normalizePattern, ruleKey } from './rules';
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from './settings';

export const EXPORT_FORMAT = 'chrome-tap-manager/backup';
export const EXPORT_VERSION = 1;

export interface ExportTopic {
  name: string;
  isNamed: boolean;
  color?: string;
  tabs: { url: string; title: string }[];
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  rules: Pick<Rule, 'kind' | 'pattern' | 'topicName' | 'priority' | 'enabled' | 'source'>[];
  settings: Settings;
  topics: ExportTopic[];
}

export function buildExport(store: Store, settings: Settings, now: number): ExportFile {
  const tabsByTopic = new Map<string, ExportTopic['tabs']>();
  for (const t of [...store.tabs].sort((a, b) => a.index - b.index)) {
    const list = tabsByTopic.get(t.topicId) ?? [];
    list.push({ url: t.url, title: t.title });
    tabsByTopic.set(t.topicId, list);
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    rules: store.rules.map((r) => ({
      kind: r.kind,
      pattern: r.pattern,
      topicName: r.topicName,
      priority: r.priority,
      enabled: r.enabled,
      source: r.source,
    })),
    settings: { ...settings },
    topics: store.topics
      .filter((t) => t.status === 'open')
      .map((t) => ({
        name: t.name,
        isNamed: t.isNamed,
        color: t.color,
        tabs: tabsByTopic.get(t.id) ?? [],
      })),
  };
}

export interface ImportResult {
  rulesAdded: number;
  rulesSkipped: number;
  settingsApplied: boolean;
  topicsInFile: number;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

const RULE_KINDS: readonly RuleKind[] = ['host', 'prefix', 'regex'];

/** Validates the JSON text and returns the parsed file, or throws ImportError. */
export function parseExport(text: string): ExportFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('JSON을 읽을 수 없습니다');
  }
  if (typeof data !== 'object' || data === null) throw new ImportError('형식이 올바르지 않습니다');
  const d = data as Partial<ExportFile>;
  if (d.format !== EXPORT_FORMAT) throw new ImportError('이 앱의 백업 파일이 아닙니다');
  if (typeof d.version !== 'number' || d.version > EXPORT_VERSION) {
    throw new ImportError(`지원하지 않는 백업 버전입니다 (${String(d.version)})`);
  }
  const rules = Array.isArray(d.rules) ? d.rules : [];
  for (const r of rules) {
    if (
      typeof r !== 'object' ||
      r === null ||
      !RULE_KINDS.includes((r as Rule).kind) ||
      typeof (r as Rule).pattern !== 'string' ||
      typeof (r as Rule).topicName !== 'string'
    ) {
      throw new ImportError('규칙 항목이 올바르지 않습니다');
    }
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: typeof d.exportedAt === 'string' ? d.exportedAt : '',
    rules: rules as ExportFile['rules'],
    settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) },
    topics: Array.isArray(d.topics) ? (d.topics as ExportTopic[]) : [],
  };
}

/** Merges rules (skipping ones with the same kind/pattern/topic) and applies settings. */
export async function applyImport(
  file: ExportFile,
  repo: Repo,
  settings: SettingsStore,
): Promise<ImportResult> {
  const existing = new Set(repo.listRules().map((r) => ruleKey(r.kind, r.pattern, r.topicName)));
  let added = 0;
  let skipped = 0;
  for (const r of file.rules) {
    const pattern = normalizePattern(r.kind, r.pattern);
    const topicName = r.topicName.trim().slice(0, TOPIC_NAME_MAX);
    if (!pattern || !topicName) {
      skipped++;
      continue;
    }
    const key = ruleKey(r.kind, pattern, topicName);
    if (existing.has(key)) {
      skipped++;
      continue;
    }
    existing.add(key);
    const rule = makeRule(
      { kind: r.kind, pattern, topicName, source: r.source ?? 'manual', priority: r.priority },
      { newId: () => repo.newId(), now: () => repo.now() },
    );
    await repo.putRule({ ...rule, enabled: r.enabled ?? true });
    added++;
  }
  await settings.update({
    rulesEnabled: file.settings.rulesEnabled,
    dismissedSuggestions: [
      ...new Set([
        ...settings.get().dismissedSuggestions,
        ...(file.settings.dismissedSuggestions ?? []),
      ]),
    ],
  });
  return {
    rulesAdded: added,
    rulesSkipped: skipped,
    settingsApplied: true,
    topicsInFile: file.topics.length,
  };
}
