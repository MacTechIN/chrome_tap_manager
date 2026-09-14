// chrome/actions.ts — ChromeActions adapter for core/commandRunner.ts.

import { browser } from '#imports';
import type { ChromeActions } from '../core/commandRunner';

export interface ActionsDeps {
  /** Resolves once the window exists in live state and its topic has been created. */
  waitForWindow(windowId: number): Promise<void>;
}

export function createChromeActions(deps: ActionsDeps): ChromeActions {
  return {
    async activateTab(chromeTabId) {
      await browser.tabs.update(chromeTabId, { active: true });
    },

    async focusWindow(windowId) {
      // Known limitation: when Chrome is not the foreground app this may only flash the
      // taskbar (OS foreground lock). The desktop app raises Chrome at OS level (spec F-08).
      await browser.windows.update(windowId, { focused: true, drawAttention: true });
    },

    async moveTabs(chromeTabIds, windowId) {
      await browser.tabs.move(chromeTabIds, { windowId, index: -1 });
    },

    async createWindow(opts) {
      const w = await browser.windows.create({
        tabId: opts.tabId,
        url: opts.urls,
        focused: opts.focused ?? true,
        type: 'normal',
      });
      if (!w?.id) throw new Error('windows.create returned no id');
      return w.id;
    },

    waitForWindow: deps.waitForWindow,

    async closeWindow(windowId) {
      await browser.windows.remove(windowId);
    },

    async tabsOfWindow(windowId) {
      const tabs = await browser.tabs.query({ windowId });
      return tabs
        .filter((t): t is chrome.tabs.Tab & { id: number } => t.id !== undefined)
        .map((t) => ({ id: t.id, url: t.url ?? t.pendingUrl ?? '' }));
    },
  };
}
