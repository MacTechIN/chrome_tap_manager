// entrypoints/options/App.tsx — settings + onboarding page (E12, spec F-15 EXT side).
// Opened on first install and from chrome://extensions. Everything here talks to the
// background through the same typed messages the popup and side panel use.

import { createResource, createSignal, For, onMount, Show } from 'solid-js';
import { browser } from '#imports';
import type { RuntimeRequest, RuntimeResponse } from '../../core/messages';

async function send(req: RuntimeRequest): Promise<RuntimeResponse> {
  const res = (await browser.runtime.sendMessage(req)) as RuntimeResponse | undefined;
  if (!res) throw new Error('백그라운드가 응답하지 않습니다. 확장을 새로고침해 주세요.');
  if (res.type === 'error') throw new Error(res.message);
  return res;
}

interface ShortcutRow {
  name: string;
  description: string;
  shortcut: string;
}

async function loadShortcuts(): Promise<ShortcutRow[]> {
  const all = await browser.commands.getAll();
  return all.map((c) => ({
    name: c.name ?? '',
    description: c.name === '_execute_action' ? '검색창 열기' : (c.description ?? c.name ?? ''),
    shortcut: c.shortcut || '(지정 안 됨)',
  }));
}

const NATIVE: chrome.permissions.Permissions = { permissions: ['nativeMessaging'] };

export default function App() {
  const manifest = browser.runtime.getManifest();
  const [shortcuts] = createResource(loadShortcuts);
  const [rulesEnabled, setRulesEnabled] = createSignal(true);
  const [bridgeState, setBridgeState] = createSignal('');
  const [bridgeGranted, setBridgeGranted] = createSignal(false);
  const [stats, setStats] = createSignal<string>('');
  const [errors, setErrors] = createSignal<string[]>([]);
  const [notice, setNotice] = createSignal<string | undefined>();
  const [error, setError] = createSignal<string | undefined>();

  async function refresh() {
    try {
      const [st, b, d, granted] = await Promise.all([
        send({ type: 'settings.get' }),
        send({ type: 'bridge.status' }),
        send({ type: 'debug.stats' }),
        browser.permissions.contains(NATIVE),
      ]);
      if (st.type === 'settings') setRulesEnabled(st.settings.rulesEnabled);
      if (b.type === 'bridge.status') setBridgeState(b.status.state);
      if (d.type === 'debug.stats') {
        setStats(
          `창 ${d.liveWindows} · 탭 ${d.liveTabs} · 주제 ${d.openTopics} · 검색 색인 ${d.indexSize}` +
            ` · seq ${d.seq} · 저장 ${Math.round((d.bytesInUse ?? 0) / 1024)} KB`,
        );
        setErrors(d.errors);
      }
      setBridgeGranted(granted);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
      await refresh();
      if (ok) setNotice(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  onMount(() => void refresh());

  const openShortcuts = () => void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });

  const toggleRules = (enabled: boolean) =>
    run(() => send({ type: 'settings.update', patch: { rulesEnabled: enabled } }));

  const enableBridge = () =>
    run(async () => {
      // permissions.request must run inside a user gesture — it does, we are in a click.
      const ok = await browser.permissions.request(NATIVE);
      if (!ok) throw new Error('권한이 거부되었습니다');
      await send({ type: 'bridge.reconnect' });
    }, '데스크톱 앱 연결을 시도합니다. 앱이 설치되어 있으면 곧 "연결됨"으로 바뀝니다.');

  const disableBridge = () =>
    run(async () => {
      await browser.permissions.remove(NATIVE);
      await send({ type: 'bridge.reconnect' });
    }, '데스크톱 앱 연결을 껐습니다.');

  const exportData = () =>
    run(async () => {
      const res = await send({ type: 'data.export' });
      if (res.type !== 'data.export') return;
      const url = URL.createObjectURL(new Blob([res.text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, '내보내기 파일을 내려받았습니다.');

  const importData = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      const res = await send({ type: 'data.import', text: await file.text() });
      if (res.type === 'data.import') {
        setNotice(
          `가져오기 완료: 규칙 ${res.result.rulesAdded}개 추가, ${res.result.rulesSkipped}개 건너뜀`,
        );
      }
    });
  };

  const resetData = () => {
    if (!confirm('주제 이름·색상·규칙·설정을 모두 지우고 현재 창을 다시 읽습니다. 계속할까요?'))
      return;
    void run(() => send({ type: 'data.reset' }), '모든 데이터를 초기화했습니다.');
  };

  const bridgeLabel = () =>
    !bridgeGranted()
      ? '꺼짐 (권한 없음)'
      : bridgeState() === 'connected'
        ? '연결됨'
        : bridgeState() === 'connecting'
          ? '연결 중…'
          : '미연결 (데스크톱 앱이 실행 중이 아니거나 설치되지 않음)';

  return (
    <main class="options">
      <header>
        <img src="/icon/48.png" alt="" width="40" height="40" />
        <div>
          <h1>{manifest.name}</h1>
          <p class="muted">버전 {manifest.version}</p>
        </div>
      </header>

      <Show when={notice()}>{(n) => <p class="notice">{n()}</p>}</Show>
      <Show when={error()}>{(e) => <p class="error">{e()}</p>}</Show>

      <section>
        <h2>시작하기</h2>
        <ol class="onboarding">
          <li>
            <b>창 하나 = 주제 하나.</b> Chrome 창을 열면 그 창이 곧 주제가 되고, 탭 내용으로 이름이
            자동으로 붙습니다. <code>&gt;rename 이름</code>으로 언제든 바꿀 수 있습니다.
          </li>
          <li>
            <b>창을 닫으면 주제도 사라집니다.</b> 저장되는 것은 규칙과 설정뿐이며, 브라우저를 다시
            열어 Chrome이 창을 복원하면 이름을 다시 찾아 붙입니다.
          </li>
          <li>
            <b>검색 한 번으로 그 창을 앞으로.</b> {shortcutOf(shortcuts(), '_execute_action')}로
            검색창을 열고 제목·주소·한글 초성을 입력한 뒤 Enter.
          </li>
          <li>
            <b>탭 정리는 "보내기" 하나.</b> <code>&gt;move 주제</code>, 탭 우클릭 → "주제로 보내기",
            또는 {shortcutOf(shortcuts(), 'send-to-last-topic')}(마지막 사용 주제로).
          </li>
          <li class="muted">
            Chrome 자체의 "창 이름 지정" 기능과는 별개입니다. 이 확장은 그 이름을 읽을 수 없으므로
            주제 이름은 여기서 관리합니다.
          </li>
        </ol>
      </section>

      <section>
        <h2>단축키</h2>
        <table>
          <tbody>
            <For each={shortcuts() ?? []}>
              {(s) => (
                <tr>
                  <td>{s.description}</td>
                  <td>
                    <kbd>{s.shortcut}</kbd>
                  </td>
                </tr>
              )}
            </For>
            <tr>
              <td>주소창 검색</td>
              <td>
                <kbd>t</kbd> + 스페이스 + 검색어
              </td>
            </tr>
          </tbody>
        </table>
        <button onClick={openShortcuts}>단축키 변경 (chrome://extensions/shortcuts)</button>
      </section>

      <section>
        <h2>규칙 자동 이동</h2>
        <label class="row">
          <input
            type="checkbox"
            checked={rulesEnabled()}
            onChange={(e) => void toggleRules(e.currentTarget.checked)}
          />
          같은 사이트를 같은 주제로 두 번 보내면 규칙을 제안하고, 수락한 규칙대로 새 탭을 자동으로
          옮깁니다
        </label>
        <p class="muted">규칙 목록은 사이드 패널의 "규칙" 섹션에서 편집합니다.</p>
      </section>

      <section>
        <h2>데스크톱 앱 연결</h2>
        <p>
          상태: <b>{bridgeLabel()}</b>
        </p>
        <p class="muted">
          Chrome이 뒤에 있을 때도 검색 창을 띄우고 창을 앞으로 가져오려면 데스크톱 앱이 필요합니다.
          연결을 켜면 "네이티브 앱과 통신" 권한을 요청합니다. 앱이 없으면 아무 일도 하지 않습니다.
        </p>
        <div class="actions">
          <Show
            when={bridgeGranted()}
            fallback={<button onClick={() => void enableBridge()}>연결 켜기</button>}
          >
            <button onClick={() => void run(() => send({ type: 'bridge.reconnect' }))}>
              다시 연결
            </button>
            <button class="quiet" onClick={() => void disableBridge()}>
              연결 끄기
            </button>
          </Show>
        </div>
      </section>

      <section>
        <h2>데이터</h2>
        <p class="muted">
          모든 데이터는 이 브라우저 안(<code>chrome.storage.local</code>)에만 있고 외부로 전송되지
          않습니다. 백업 파일에는 규칙·설정과 현재 열린 주제·탭 주소가 담깁니다.
        </p>
        <div class="actions">
          <button onClick={() => void exportData()}>JSON 내보내기</button>
          <label class="file">
            JSON 가져오기
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                importData(f);
              }}
            />
          </label>
          <button class="danger" onClick={resetData}>
            모든 데이터 초기화
          </button>
        </div>
      </section>

      <section>
        <h2>진단</h2>
        <p class="mono">{stats()}</p>
        <Show when={errors().length > 0}>
          <details>
            <summary>최근 오류 {errors().length}건</summary>
            <ul class="mono">
              <For each={errors()}>{(e) => <li>{e}</li>}</For>
            </ul>
          </details>
        </Show>
        <button class="quiet" onClick={() => void refresh()}>
          새로고침
        </button>
      </section>
    </main>
  );
}

function shortcutOf(rows: ShortcutRow[] | undefined, name: string): string {
  return rows?.find((r) => r.name === name)?.shortcut ?? '단축키';
}
