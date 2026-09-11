import { browser, defineBackground } from '#imports';

// E01: empty service worker. E03 adds window/tab event collection.
export default defineBackground(() => {
  console.log('[ctm] background started', { id: browser.runtime.id });
});
