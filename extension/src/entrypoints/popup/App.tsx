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
import type { RuntimeRequest, RuntimeResponse } from '../../core/messages';
import type { SearchHit, SearchScope } from '../../core/search/index';

async function send(req: RuntimeRequest): Promise<RuntimeResponse> {
  return (await browser.runtime.sendMessage(req)) as RuntimeResponse;
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
    let scope: SearchScope = { kind: 'all' };
    let text = parsed.text;
    if (parsed.mode === 'saved') scope = { kind: 'saved' };
    if (parsed.mode === 'topic') {
      const t = rankTopics(parsed.topicQuery, topics())[0];
      if (t) scope = { kind: 'topic', topicId: t.id };
      text = parsed.text;
    }
    const res = await send({
      type: 'search',
      text,
      scope,
      currentWindowId: currentWindowId(),
      limit: 30,
    });
    if (id !== queryId) return; // stale
    setRows(res.type === 'search' ? res.hits.map((hit) => ({ kind: 'hit', hit })) : []);
    setSelected(0);
  }

  onMount(async () => {
    inputEl?.focus();
    await loadContext();
    await refresh();
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
        case 'open':
          expectOk(await send({ type: 'cmd.open', topicId: s.topic!.id }));
          return done();
        case 'merge':
          expectOk(
            await send({
              type: 'cmd.merge',
              topicId: s.topic!.id,
              fromWindowId: currentWindowId()!,
            }),
          );
          return done();
        case 'close':
        case 'save':
          setNotice({ kind: 'info', text: `>${s.command}는 E11(세션 저장)에서 지원됩니다` });
          return;
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
      : 'Enter 탭으로 이동 · Ctrl+Enter 창만 · > 명령 · # 주제 · @saved 저장됨';

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
      <p class="hint">{hint()}</p>
    </main>
  );
}
