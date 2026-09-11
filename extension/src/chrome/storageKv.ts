// chrome/storageKv.ts — KeyValueStore backed by chrome.storage.local.
// Thin adapter; all logic lives in core/repo.ts.

import { browser } from '#imports';
import type { KeyValueStore } from '../core/repo';

type Area = 'local' | 'session';

export class ChromeStorageKV implements KeyValueStore {
  constructor(private readonly area: Area = 'local') {}

  private get store() {
    return browser.storage[this.area];
  }

  async get<T>(key: string): Promise<T | undefined> {
    const result = await this.store.get(key);
    return result[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.store.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await this.store.remove(key);
  }
}
