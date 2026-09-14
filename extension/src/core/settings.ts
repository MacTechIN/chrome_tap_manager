// core/settings.ts — small typed settings document over a KeyValueStore.

import type { KeyValueStore } from './repo';

export const SETTINGS_KEY = 'ctm:settings';

export interface Settings {
  /** Master switch for automatic rule moves. */
  rulesEnabled: boolean;
  /** Suggestion keys the user answered "다시 묻지 않기" to. */
  dismissedSuggestions: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  rulesEnabled: true,
  dismissedSuggestions: [],
};

export class SettingsStore {
  private cache: Settings = { ...DEFAULT_SETTINGS };

  constructor(private readonly kv: KeyValueStore) {}

  async load(): Promise<Settings> {
    const stored = await this.kv.get<Partial<Settings>>(SETTINGS_KEY);
    this.cache = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
    return this.get();
  }

  get(): Settings {
    return { ...this.cache, dismissedSuggestions: [...this.cache.dismissedSuggestions] };
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    this.cache = { ...this.cache, ...patch };
    await this.kv.set(SETTINGS_KEY, this.cache);
    return this.get();
  }

  async dismissSuggestion(key: string): Promise<void> {
    if (this.cache.dismissedSuggestions.includes(key)) return;
    await this.update({ dismissedSuggestions: [...this.cache.dismissedSuggestions, key] });
  }
}
