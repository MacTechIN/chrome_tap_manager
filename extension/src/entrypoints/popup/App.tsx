import { createEffect, createSignal, For, onMount, Show } from 'solid-js';
import { browser } from '#imports';
import {
  type CommandSuggestion,
  parseInput,
  rankTopics,
  suggestCommands,
  type TopicRef,
} from '../../core/command';
import { enterVariant, type EnterVariant } from '../../core/ime';
import type { AutoMove } from '../../core/autoMover';
import type { RuntimeRequest, RuntimeResponse } from '../../core/messages';
import type { RuleSuggestion } from '../../core/ruleSuggest';
import type { SearchHit, SearchScope } from '../../core/search/index';

async function send(req: RuntimeRequest): Promise<RuntimeResponse> {
  const res = (await browser.runtime.sendMessage(req)) as RuntimeResponse | undefined;
  if (!res) {
    // No listener answered: the service worker crashed at startup or is not running.
    throw new Error(
      '백그라운드가 응답하지 않습니다. chrome://extensions에서 확장을 새로고침해 주세요.',
    );
  }
  return res;
}

type Row = { kind: 'hit'; hit: SearchHit } | { kind: 'suggestion'; s: CommandSuggestion };

export default function App() {
  const [input, setInput] = createSignal('');
  const [rows, setRows] = createSignal<Row[]>([]);
  const [selected, setSelected] = createSignal(0);
  const [topics, setTopics] = createSignal<TopicRef[]>([]);
  const [currentWindowId, setCurrentWindowId] = createSignal<number | undefined>();
  const [currentTabIds, setCurrentTabIds] = createSignal<number[]>([]);
  const [notice, setNotice] = createSignal<{ kind: 'info' | 'error'; text: string } | undefined>();
  const [busy, setBusy] = createSignal(false);
  const [stats, setStats] = createSignal<string>('');
  const [suggestion, setSuggestion] = createSignal<RuleSuggestion | undefined>();
  const [autoMove, setAutoMove] = createSignal<AutoMove | undefined>();
  const [pendingClose, setPendingClose] = createSignal<
    { topicId?: string; name: string; tabs: number } | undefined
  >();
  const [bgErrors, setBgErrors] = createSignal<string[]>([]);

  async function loadRuleContext() {
    try {
      const [sg, am] = await Promise.all([
        send({ type: 'rules.suggestions' }),
        send({ type: 'automove.recent', withinMs: 60_000 }),
      ]);
      setSuggestion(sg.type === 'rules.suggestions' ? sg.suggestions[0] : undefined);
      setAutoMove(am.type === 'automove.recent' ? am.moves[0] : undefined);
    } catch {
      /* diagnostics line reports background trouble */
    }
  }

  async function answerSuggestion(action: 'accept' | 'later' | 'never') {
    const sg = suggestion();
    if (!sg) return;
    setSuggestion(undefined);
    if (action === 'later') return;
    await guard(async () => {
      if (action === 'accept') {
        expectOk(await send({ type: 'rules.accept', key: sg.key }));
        setNotice({ kind: 'info', text: `규칙 추가: ${sg.pattern} → ${sg.topicName}` });
      } else {
        expectOk(await send({ type: 'rules.dismiss', key: sg.key }));
      }
    });
  }

  async function undoAutoMove() {
    const m = autoMove();
    if (!m) return;
    setAutoMove(undefined);
    await guard(async () => {
      const res = expectOk(await send({ type: 'automove.undo', id: m.id }));
      if (res.type === 'automove.undo' && res.result.ruleDisabled) {
        setNotice({
          kind: 'info',
          text: `되돌렸습니다. 규칙 "${res.result.ruleDisabled.pattern}"은 3회 되돌려져 비활성화됐습니다`,
        });
      } else {
        setNotice({ kind: 'info', text: '되돌렸습니다' });
      }
      await loadContext();
      await refresh();
    });
  }

  async function loadStats() {
    try {
      const res = await send({ type: 'debug.stats' });
      if (res.type !== 'debug.stats') {
        setStats(
          res.type === 'error'
            ? `진단 실패: ${res.message} (확장을 새로고침하면 백그라운드가 갱신됩니다)`
            : `진단 응답 형식 오류: ${res.type}`,
        );
        return;
      }
      const kb = res.bytesInUse === undefined ? '?' : Math.round(res.bytesInUse / 1024).toString();
      let bridgeText = '';
      try {
        const b = await send({ type: 'bridge.status' });
        if (b.type === 'bridge.status') {
          const st = b.status.state;
          bridgeText =
            st === 'connected' ? ' · 브리지 연결됨' : st === 'stopped' ? '' : ' · 브리지 미연결';
        }
      } catch {
        /* ignore */
      }
      setStats(
        `주제 ${res.openTopics}/${res.topics} · 탭 ${res.openTabs}/${res.tabs} · 색인 ${res.indexSize}` +
          `${res.indexDirty ? '*' : ''} · 창 ${res.liveWindows} · 라이브탭 ${res.liveTabs} · seq ${res.seq}` +
          ` · 저장 ${kb}KB${res.freshSession ? ' · 새 세션' : ''}${bridgeText}`,
      );
      setBgErrors(res.errors);
    } catch (err) {
      setStats(String(err instanceof Error ? err.message : err));
    }
  }
  let inputEl: HTMLInputElement | undefined;
  let listEl: HTMLUListElement | undefined;
  let queryId = 0;

  const currentTopicId = () => topics().find((t) => t.windowId === currentWindowId())?.id;
  const mode = () => parseInput(input()).mode;

  async function loadContext() {
    const [win, hi, res] = await Promise.all([
      browser.windows.getCurrent(),
      browser.tabs.query({ highlighted: true, currentWindow: true }),
      send({ type: 'topics.list' }),
    ]);
    setCurrentWindowId(win.id);
    let ids = hi.map((t) => t.id).filter((id): id is number => id !== undefined);
    if (ids.length === 0) {
      const [active] = await browser.tabs.query({ active: true, currentWindow: true });
      if (active?.id !== undefined) ids = [active.id];
    }
    setCurrentTabIds(ids);
    if (res.type === 'topics.list') {
      setTopics(
        res.topics.map((t) => ({ id: t.id, name: t.name, status: t.status, windowId: t.windowId })),
      );
    }
  }

  async function refresh() {
    const id = ++queryId;
    const parsed = parseInput(input());
    if (parsed.mode === 'command') {
      const s = suggestCommands(parsed, topics(), { currentTopicId: currentTopicId() });
      setRows(s.map((x) => ({ kind: 'suggestion', s: x })));
      setSelected(0);
      return;
    }
    // Only what is open right now (a topic lives only while its window exists).
    let scope: SearchScope = { kind: 'open' };
    let text = parsed.text;
    if (parsed.mode === 'topic') {
      const t = rankTopics(parsed.topicQuery, topics())[0];
      if (t) scope = { kind: 'topic', topicId: t.id };
      text = parsed.text;
    }
    let res: RuntimeResponse;
    try {
      res = await send({
        type: 'search',
        text,
        scope,
        currentWindowId: currentWindowId(),
        limit: 30,
      });
    } catch (err) {
      if (id !== queryId) return;
      setRows([]);
      setNotice({ kind: 'error', text: String(err instanceof Error ? err.message : err) });
      return;
    }
    if (id !== queryId) return; // stale
    if (res.type === 'error') {
      setRows([]);
      setNotice({ kind: 'error', text: `검색 실패: ${res.message}` });
      return;
    }
    setRows(res.type === 'search' ? res.hits.map((hit) => ({ kind: 'hit', hit })) : []);
    setSelected(0);
  }

  onMount(async () => {
    inputEl?.focus();
    try {
      await loadContext();
    } catch (err) {
      setNotice({ kind: 'error', text: String(err instanceof Error ? err.message : err) });
    }
    await refresh();
    void loadStats();
    void loadRuleContext();
  });

  createEffect(() => {
    selected();
    const el = listEl?.querySelector<HTMLElement>('li.selected');
    el?.scrollIntoView({ block: 'nearest' });
  });

  const moveSelection = (delta: number) => {
    const n = rows().length;
    if (n === 0) return;
    setSelected((i) => (i + delta + n) % n);
  };

  const done = (text?: string) => {
    if (text) setNotice({ kind: 'info', text });
    else window.close();
  };

  async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (busy()) return undefined;
    setBusy(true);
    setNotice(undefined);
    try {
      return await fn();
    } catch (err) {
      setNotice({ kind: 'error', text: String(err) });
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const expectOk = (res: RuntimeResponse) => {
    if (res.type === 'error') throw new Error(res.message);
    return res;
  };

  async function runHit(hit: SearchHit, variant: EnterVariant) {
    await guard(async () => {
      const mode = variant === 'window' ? 'window' : 'tab';
      const target =
        hit.doc.kind === 'topic'
          ? ({ kind: 'topic', topicId: hit.doc.topicId } as const)
          : ({ kind: 'tab', tabRowId: hit.doc.tabId } as const);
      expectOk(await send({ type: 'cmd.focus', target, mode }));
      done();
    });
  }

  async function runSuggestion(s: CommandSuggestion, variant: EnterVariant) {
    if (!s.complete) {
      setInput(s.fill);
      await refresh();
      inputEl?.focus();
      return;
    }
    await guard(async () => {
      switch (s.command) {
        case 'move': {
          const res = expectOk(
            await send({
              type: 'cmd.move',
              topicId: s.topic!.id,
              chromeTabIds: currentTabIds(),
              switchTo: variant === 'switch',
            }),
          );
          if (variant === 'switch') return done();
          const n = res.type === 'move' ? res.result.moved : 0;
          setInput('');
          await loadContext();
          await refresh();
          done(`${n}개 탭을 "${s.topic!.name}"(으)로 보냈습니다`);
          void loadRuleContext();
          return;
        }
        case 'new':
          expectOk(await send({ type: 'cmd.new', chromeTabIds: currentTabIds(), name: s.arg }));
          return done();
        case 'rename': {
          const res = expectOk(
            await send({ type: 'cmd.rename', name: s.arg ?? '', windowId: currentWindowId() }),
          );
          setInput('');
          await loadContext();
          await refresh();
          done(res.type === 'topic' ? `이름을 "${res.topic.name}"(으)로 바꿨습니다` : '완료');
          return;
        }
        case 'merge':
          expectOk(
            await send({
              type: 'cmd.merge',
              topicId: s.topic!.id,
              fromWindowId: currentWindowId()!,
            }),
          );
          return done();
        case 'close': {
          // Two-step: show what will be closed, close only on explicit confirmation.
          const target = s.topic ?? topics().find((t) => t.windowId === currentWindowId());
          if (!target) throw new Error('닫을 창의 주제를 찾을 수 없습니다');
          const tree = await send({ type: 'sidepanel.tree' });
          const tabs =
            tree.type === 'sidepanel.tree'
              ? (tree.topics.find((t) => t.id === target.id)?.tabCount ?? 0)
              : 0;
          setPendingClose({ topicId: target.id, name: target.name, tabs });
          return;
        }
      }
    });
  }

  const onKeyDown = async (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') return (e.preventDefault(), moveSelection(1));
    if (e.key === 'ArrowUp') return (e.preventDefault(), moveSelection(-1));
    if (e.key === 'Escape') {
      e.preventDefault();
      if (input()) {
        setInput('');
        await refresh();
      } else window.close();
      return;
    }
    const row = rows()[selected()];
    if (e.key === 'Tab' && row?.kind === 'suggestion') {
      e.preventDefault();
      setInput(row.s.fill);
      await refresh();
      return;
    }
    const variant = enterVariant(e);
    if (!variant) return;
    e.preventDefault();
    if (!row) return;
    if (row.kind === 'hit') await runHit(row.hit, variant);
    else await runSuggestion(row.s, variant);
  };

  const hint = () =>
    mode() === 'command'
      ? 'Enter 실행 · Tab 완성 · Shift+Enter 보낸 뒤 이동 · Esc 지우기'
      : 'Enter 탭으로 이동 · Ctrl+Enter 창만 · > 명령 · # 주제';

  return (
    <main class="popup">
      <input
        ref={inputEl}
        class="query"
        placeholder="탭·주제 검색, > 명령"
        value={input()}
        autocomplete="off"
        spellcheck={false}
        onInput={(e) => {
          setInput(e.currentTarget.value);
          void refresh();
        }}
        onKeyDown={onKeyDown}
      />

      <Show when={autoMove()}>
        {(m) => (
          <p class="banner">
            <span>규칙이 탭을 "{m().toTopicName}"(으)로 보냈습니다</span>
            <button onClick={() => void undoAutoMove()}>되돌리기</button>
          </p>
        )}
      </Show>
      <Show when={pendingClose()}>
        {(pc) => (
          <p class="banner">
            <span>
              "{pc().name}" 창(탭 {pc().tabs}개)을 닫을까요? 주제도 함께 사라집니다.
            </span>
            <button
              onClick={() =>
                void guard(async () => {
                  const pending = pc();
                  setPendingClose(undefined);
                  expectOk(await send({ type: 'cmd.close', topicId: pending.topicId }));
                  if (pending.topicId === currentTopicId()) return done();
                  await loadContext();
                  await refresh();
                  done(`"${pending.name}" 창을 닫았습니다`);
                })
              }
            >
              닫기
            </button>
            <button class="quiet" onClick={() => setPendingClose(undefined)}>
              취소
            </button>
          </p>
        )}
      </Show>
      <Show when={suggestion()}>
        {(sg) => (
          <p class="banner">
            <span>
              <b>{sg().pattern}</b> 탭을 앞으로 "{sg().topicName}"(으)로 자동으로 보낼까요?
            </span>
            <button onClick={() => void answerSuggestion('accept')}>예</button>
            <button onClick={() => void answerSuggestion('later')}>아니오</button>
            <button class="quiet" onClick={() => void answerSuggestion('never')}>
              다시 묻지 않기
            </button>
          </p>
        )}
      </Show>
      <ul class="rows" ref={listEl}>
        <For each={rows()}>
          {(row, i) => (
            <li
              classList={{ selected: i() === selected() }}
              onMouseEnter={() => setSelected(i())}
              onClick={() =>
                row.kind === 'hit' ? runHit(row.hit, 'plain') : runSuggestion(row.s, 'plain')
              }
            >
              <Show when={row.kind === 'hit' && row.hit.doc.kind === 'topic' && row.hit.doc}>
                {(d) => (
                  <>
                    <span class="icon topic">◆</span>
                    <span class="main">
                      <span class="title" classList={{ unnamed: !d().isNamed }}>
                        {d().name}
                      </span>
                      <span class="meta">
                        주제 · {d().tabCount}탭 · {d().status === 'open' ? '열림' : '저장됨'}
                        {d().windowId === currentWindowId() ? ' · 현재 창' : ''}
                      </span>
                    </span>
                  </>
                )}
              </Show>
              <Show when={row.kind === 'hit' && row.hit.doc.kind === 'tab' && row.hit.doc}>
                {(d) => (
                  <>
                    <span class="icon">
                      <Show
                        when={d().favicon}
                        fallback={
                          <span class="fav-fallback">
                            {(d().host || d().title).slice(0, 1).toUpperCase()}
                          </span>
                        }
                      >
                        <img src={d().favicon} alt="" width="16" height="16" />
                      </Show>
                    </span>
                    <span class="main">
                      <span class="title">{d().title || d().url}</span>
                      <span class="meta">
                        {d().host} · {d().topicName}
                        {d().isOpen ? '' : ' · 저장됨'}
                        {d().windowId === currentWindowId() ? ' · 현재 창' : ''}
                      </span>
                    </span>
                  </>
                )}
              </Show>
              <Show when={row.kind === 'suggestion' && row.s}>
                {(s) => (
                  <>
                    <span class="icon cmd">›</span>
                    <span class="main">
                      <span class="title">{s().label}</span>
                      <span class="meta">{s().description}</span>
                    </span>
                  </>
                )}
              </Show>
            </li>
          )}
        </For>
        <Show when={rows().length === 0 && input()}>
          <li class="empty">결과 없음</li>
        </Show>
      </ul>

      <Show when={notice()}>{(n) => <p class={`notice ${n().kind}`}>{n().text}</p>}</Show>
      <p class="hint">
        {hint()}
        {' · '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            const api = (
              browser as unknown as { sidePanel?: { open(o: { windowId: number }): Promise<void> } }
            ).sidePanel;
            const wid = currentWindowId();
            if (api && wid !== undefined) void api.open({ windowId: wid });
          }}
        >
          사이드 패널
        </a>
      </p>
      <Show when={stats()}>
        <p class="hint stats" title="진단 정보 (열림/전체)">
          {stats()}
        </p>
      </Show>
      <Show when={bgErrors().length > 0}>
        <p class="notice error">
          <For each={bgErrors()}>{(e) => <span class="bg-error">{e}</span>}</For>
        </p>
      </Show>
    </main>
  );
}
