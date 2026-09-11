import { createResource, Show } from 'solid-js';
import { browser } from '#imports';
import { summarize } from '../../core/summary';

async function loadSummary() {
  const windows = await browser.windows.getAll({ populate: true, windowTypes: ['normal'] });
  return summarize(windows.map((w) => ({ id: w.id ?? -1, tabCount: w.tabs?.length ?? 0 })));
}

export default function App() {
  const [summary] = createResource(loadSummary);
  const manifest = browser.runtime.getManifest();

  return (
    <main class="popup">
      <h1>{manifest.name}</h1>
      <p class="muted">v{manifest.version} · E01 scaffold</p>
      <Show when={summary()} fallback={<p>불러오는 중…</p>}>
        {(s) => (
          <p>
            일반 창 <b>{s().windows}</b>개 · 탭 <b>{s().tabs}</b>개
          </p>
        )}
      </Show>
    </main>
  );
}
