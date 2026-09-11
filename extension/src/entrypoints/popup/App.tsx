import { createResource, For, Show } from 'solid-js';
import { browser } from '#imports';
import { activeTabOf, counts, windowList, type LiveState } from '../../core/liveState';
import type { LiveGetResponse, RuntimeRequest } from '../../core/messages';

async function fetchLive(): Promise<LiveGetResponse> {
  const req: RuntimeRequest = { type: 'live.get' };
  return (await browser.runtime.sendMessage(req)) as LiveGetResponse;
}

function shortTitle(s: string, n = 40): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default function App() {
  const [live, { refetch }] = createResource(fetchLive);
  const manifest = browser.runtime.getManifest();

  const summary = (state: LiveState) => counts(state);

  return (
    <main class="popup">
      <h1>{manifest.name}</h1>
      <p class="muted">v{manifest.version} · E03 live state</p>
      <Show when={live()} fallback={<p>불러오는 중…</p>}>
        {(r) => (
          <>
            <p>
              일반 창 <b>{summary(r().state).windows}</b>개 · 탭 <b>{summary(r().state).tabs}</b>개
              · seq <b>{r().state.seq}</b>
            </p>
            <ul class="windows">
              <For each={windowList(r().state)}>
                {(w) => (
                  <li classList={{ focused: w.focused }}>
                    <span class="wid">#{w.id}</span> {w.tabIds.length}탭
                    <span class="muted">
                      {' '}
                      · {shortTitle(activeTabOf(r().state, w.id)?.title ?? '')}
                    </span>
                  </li>
                )}
              </For>
            </ul>
            <p class="muted small">
              SW 시작 {new Date(r().startedAt).toLocaleTimeString()} ·{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), refetch())}>
                새로고침
              </a>
            </p>
          </>
        )}
      </Show>
    </main>
  );
}
