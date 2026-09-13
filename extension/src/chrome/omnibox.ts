// chrome/omnibox.ts — address-bar keyword search ("t" + space), spec F-11.
// All ranking/formatting lives in core/omniboxSuggest.ts; this only wires Chrome events.

import { browser } from '#imports';
import {
  buildSuggestions,
  defaultDescription,
  type OmniboxTarget,
  OMNIBOX_LIMIT,
  parseTarget,
  targetOf,
} from '../core/omniboxSuggest';
import type { SearchHit } from '../core/search/index';

export interface OmniboxDeps {
  search(text: string, limit: number): Promise<SearchHit[]>;
  activate(target: OmniboxTarget): Promise<void>;
  log?: (msg: string, data?: unknown) => void;
}

export function registerOmnibox(deps: OmniboxDeps): void {
  // `chrome.omnibox` only exists when the manifest declares `omnibox.keyword`. A stale
  // manifest (e.g. dev build not regenerated) must not take the whole service worker down.
  if (!browser.omnibox) {
    deps.log?.('omnibox API unavailable — manifest lacks "omnibox"; skipping');
    return;
  }
  let generation = 0;

  const setDefault = (text: string) => {
    browser.omnibox.setDefaultSuggestion({ description: defaultDescription(text) });
  };

  browser.omnibox.onInputStarted.addListener(() => {
    generation++;
    setDefault('');
  });

  browser.omnibox.onInputChanged.addListener(
    (text: string, suggest: (results: chrome.omnibox.SuggestResult[]) => void) => {
      const mine = ++generation;
      setDefault(text);
      deps
        .search(text, OMNIBOX_LIMIT)
        .then((hits) => {
          if (mine !== generation) return; // a newer keystroke won
          suggest(buildSuggestions(hits, text));
        })
        .catch((err) => {
          deps.log?.('omnibox search failed', err);
          suggest([]);
        });
    },
  );

  browser.omnibox.onInputEntered.addListener((text: string) => {
    generation++;
    const direct = parseTarget(text);
    const run = async () => {
      if (direct) return deps.activate(direct);
      // The default suggestion was accepted: use the best hit for the typed text.
      const [best] = await deps.search(text, 1);
      if (best) return deps.activate(targetOf(best));
      deps.log?.('omnibox: no match', { text });
    };
    run().catch((err) => deps.log?.('omnibox activate failed', err));
  });

  browser.omnibox.onInputCancelled.addListener(() => {
    generation++;
  });
}
