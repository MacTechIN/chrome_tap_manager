import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { summarize } from '../src/core/summary';

describe('summarize', () => {
  it('counts windows and tabs', () => {
    expect(
      summarize([
        { id: 1, tabCount: 3 },
        { id: 2, tabCount: 5 },
      ]),
    ).toEqual({ windows: 2, tabs: 8 });
  });

  it('handles no windows', () => {
    expect(summarize([])).toEqual({ windows: 0, tabs: 0 });
  });
});

describe('wxt fake browser', () => {
  it('is available for later chrome/ adapter tests', async () => {
    fakeBrowser.reset();
    await fakeBrowser.storage.local.set({ ping: 'pong' });
    expect(await fakeBrowser.storage.local.get('ping')).toEqual({ ping: 'pong' });
  });
});
