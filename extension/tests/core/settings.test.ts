import { describe, expect, it } from 'vitest';
import { MemoryKV } from '../../src/core/repo';
import { DEFAULT_SETTINGS, SETTINGS_KEY, SettingsStore } from '../../src/core/settings';

describe('SettingsStore', () => {
  it('loads defaults, merges stored values, persists updates', async () => {
    const kv = new MemoryKV();
    await kv.set(SETTINGS_KEY, { rulesEnabled: false });
    const s = new SettingsStore(kv);
    expect(await s.load()).toEqual({ ...DEFAULT_SETTINGS, rulesEnabled: false });
    await s.update({ rulesEnabled: true });
    await s.dismissSuggestion('host|a.com|dev');
    await s.dismissSuggestion('host|a.com|dev'); // idempotent
    expect(await kv.get(SETTINGS_KEY)).toEqual({
      rulesEnabled: true,
      dismissedSuggestions: ['host|a.com|dev'],
    });
    // get() returns copies
    const g = s.get();
    g.dismissedSuggestions.push('x');
    expect(s.get().dismissedSuggestions).toEqual(['host|a.com|dev']);
  });
});
