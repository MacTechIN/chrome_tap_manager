import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyImport,
  buildExport,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  parseExport,
} from '../../src/core/exportImport';
import { emptyStore, type Store } from '../../src/core/model';
import { MemoryKV, Repo } from '../../src/core/repo';
import { makeRule } from '../../src/core/rules';
import { DEFAULT_SETTINGS, SettingsStore } from '../../src/core/settings';

const NOW = 1_700_000_000_000;

function store(): Store {
  return {
    ...emptyStore(),
    topics: [
      {
        id: 't1',
        name: 'Dev',
        isNamed: true,
        status: 'open',
        windowId: 10,
        color: 'blue',
        browser: 'chrome',
        lastActiveAt: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    tabs: [
      {
        id: 'b',
        topicId: 't1',
        fingerprint: 'f',
        url: 'https://b/',
        title: 'B',
        chromeTabId: 2,
        index: 1,
        isOpen: true,
        lastActiveAt: 1,
        updatedAt: 1,
      },
      {
        id: 'a',
        topicId: 't1',
        fingerprint: 'f',
        url: 'https://a/',
        title: 'A',
        chromeTabId: 1,
        index: 0,
        isOpen: true,
        lastActiveAt: 1,
        updatedAt: 1,
      },
    ],
    rules: [
      {
        id: 'r1',
        topicName: 'Dev',
        kind: 'host',
        pattern: 'github.com',
        priority: 100,
        source: 'learned',
        enabled: false,
        undoCount: 3,
        createdAt: 5,
      },
    ],
  };
}

describe('buildExport', () => {
  it('captures rules, settings and open topics with ordered tab urls', () => {
    const f = buildExport(store(), { ...DEFAULT_SETTINGS, rulesEnabled: false }, NOW);
    expect(f.format).toBe(EXPORT_FORMAT);
    expect(f.version).toBe(EXPORT_VERSION);
    expect(f.exportedAt).toBe(new Date(NOW).toISOString());
    expect(f.rules).toEqual([
      {
        kind: 'host',
        pattern: 'github.com',
        topicName: 'Dev',
        priority: 100,
        enabled: false,
        source: 'learned',
      },
    ]);
    expect(f.settings.rulesEnabled).toBe(false);
    expect(f.topics).toEqual([
      {
        name: 'Dev',
        isNamed: true,
        color: 'blue',
        tabs: [
          { url: 'https://a/', title: 'A' },
          { url: 'https://b/', title: 'B' },
        ],
      },
    ]);
  });
});

describe('parseExport', () => {
  it('accepts a valid file and fills defaults', () => {
    const f = parseExport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, rules: [] }));
    expect(f.settings).toEqual(DEFAULT_SETTINGS);
    expect(f.topics).toEqual([]);
    expect(f.exportedAt).toBe('');
  });

  it('rejects garbage, foreign files, newer versions and bad rules', () => {
    expect(() => parseExport('{')).toThrow(/JSON/);
    expect(() => parseExport('"x"')).toThrow(/형식/);
    expect(() => parseExport(JSON.stringify({ format: 'other', version: 1 }))).toThrow(/백업 파일/);
    expect(() => parseExport(JSON.stringify({ format: EXPORT_FORMAT, version: 99 }))).toThrow(
      /버전/,
    );
    expect(() =>
      parseExport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, rules: [{ kind: 'x' }] })),
    ).toThrow(/규칙/);
  });
});

describe('applyImport', () => {
  let repo: Repo;
  let settings: SettingsStore;
  beforeEach(async () => {
    let n = 0;
    repo = new Repo(new MemoryKV(), { now: () => NOW, newId: () => `id-${++n}` });
    await repo.init();
    settings = new SettingsStore(new MemoryKV());
    await settings.load();
  });

  it('adds new rules, skips duplicates by intent and invalid ones, merges settings', async () => {
    await repo.putRule(
      makeRule(
        { kind: 'host', pattern: 'github.com', topicName: 'Dev' },
        {
          newId: () => 'existing',
          now: () => 1,
        },
      ),
    );
    await settings.dismissSuggestion('host|old.com|x');
    const file = parseExport(
      JSON.stringify({
        format: EXPORT_FORMAT,
        version: 1,
        rules: [
          { kind: 'host', pattern: 'https://www.GitHub.com/', topicName: ' dev ' }, // dup by intent
          { kind: 'prefix', pattern: 'github.com/MacTechIN', topicName: 'Dev', enabled: false },
          { kind: 'regex', pattern: '', topicName: 'Dev' }, // invalid → skipped
          { kind: 'host', pattern: 'a.com', topicName: '   ' }, // invalid → skipped
        ],
        settings: { rulesEnabled: false, dismissedSuggestions: ['host|new.com|y'] },
      }),
    );
    const r = await applyImport(file, repo, settings);
    expect(r).toEqual({ rulesAdded: 1, rulesSkipped: 3, settingsApplied: true, topicsInFile: 0 });
    const rules = repo.listRules();
    expect(rules).toHaveLength(2);
    expect(rules.find((x) => x.kind === 'prefix')).toMatchObject({
      pattern: 'github.com/MacTechIN',
      enabled: false,
      source: 'manual',
    });
    expect(settings.get()).toEqual({
      rulesEnabled: false,
      dismissedSuggestions: ['host|old.com|x', 'host|new.com|y'],
    });
  });

  it('round-trips: export → import into an empty store yields the same rules', async () => {
    const file = buildExport(store(), DEFAULT_SETTINGS, NOW);
    const r = await applyImport(parseExport(JSON.stringify(file)), repo, settings);
    expect(r.rulesAdded).toBe(1);
    expect(repo.listRules()[0]).toMatchObject({
      kind: 'host',
      pattern: 'github.com',
      topicName: 'Dev',
      enabled: false,
      source: 'learned',
    });
  });
});
