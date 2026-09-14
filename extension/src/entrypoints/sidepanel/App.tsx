import { createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { browser } from '#imports';
import { isCommitEnter } from '../../core/ime';
import type { RuntimeRequest, RuntimeResponse } from '../../core/messages';
import type { Rule, RuleKind, TopicColor } from '../../core/model';
import type { TopicTree, TreeTab } from '../../core/topicService';

const COLORS: TopicColor[] = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
];

async function send(req: RuntimeRequest): Promise<RuntimeResponse> {
  const res = (await browser.runtime.sendMessage(req)) as RuntimeResponse | undefined;
  if (!res) throw new Error('백그라운드가 응답하지 않습니다. 확장을 새로고침해 주세요.');
  if (res.type === 'error') throw new Error(res.message);
  return res;
}

async function fetchTree(): Promise<{ topics: TopicTree[]; currentWindowId?: number }> {
  const [res, win] = await Promise.all([
    send({ type: 'sidepanel.tree' }),
    browser.windows.getCurrent(),
  ]);
  return { topics: res.type === 'sidepanel.tree' ? res.topics : [], currentWindowId: win.id };
}

const DRAG_MIME = 'application/x-ctm-tab';

export default function App() {
  const [data, { refetch }] = createResource(fetchTree);
  const [editing, setEditing] = createSignal<string | undefined>();
  const [draft, setDraft] = createSignal('');
  const [colorFor, setColorFor] = createSignal<string | undefined>();
  const [error, setError] = createSignal<string | undefined>();
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = createSignal<string | undefined>();
  const [rules, setRules] = createSignal<Rule[]>([]);
  const [bridgeState, setBridgeState] = createSignal<string>('');
  const [rulesOpen, setRulesOpen] = createSignal(false);
  const [rulesEnabled, setRulesEnabled] = createSignal(true);
  const [newKind, setNewKind] = createSignal<RuleKind>('host');
  const [newPattern, setNewPattern] = createSignal('');
  const [newTopic, setNewTopic] = createSignal('');

  async function loadRules() {
    try {
      const [r, st, b] = await Promise.all([
        send({ type: 'rules.list' }),
        send({ type: 'settings.get' }),
        send({ type: 'bridge.status' }),
      ]);
      if (r.type === 'rules.list') setRules(r.rules);
      if (st.type === 'settings') setRulesEnabled(st.settings.rulesEnabled);
      if (b.type === 'bridge.status') setBridgeState(b.status.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function exportData() {
    await run(async () => {
      const res = await send({ type: 'data.export' });
      if (res.type !== 'data.export') return;
      const blob = new Blob([res.text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  async function importData(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    await run(async () => {
      const res = await send({ type: 'data.import', text });
      if (res.type === 'data.import') {
        setError(undefined);
        alert(
          `가져오기 완료: 규칙 ${res.result.rulesAdded}개 추가, ${res.result.rulesSkipped}개 건너뜀`,
        );
      }
      await loadRules();
    });
  }

  async function resetData() {
    if (!confirm('주제 이름·색상·규칙·설정을 모두 지우고 현재 창을 다시 읽습니다. 계속할까요?'))
      return;
    await run(async () => {
      await send({ type: 'data.reset' });
      await loadRules();
    });
  }

  const putRule = () =>
    run(async () => {
      const res = await send({
        type: 'rules.put',
        kind: newKind(),
        pattern: newPattern(),
        topicName: newTopic(),
      });
      if (res.type === 'rules.list') setRules(res.rules);
      setNewPattern('');
    });

  // Refresh when tabs/windows change (cheap: the SW answers from its cache).
  onMount(() => {
    void loadRules();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refetch(), 300);
    };
    browser.tabs.onUpdated.addListener(bump);
    browser.tabs.onRemoved.addListener(bump);
    browser.tabs.onCreated.addListener(bump);
    browser.tabs.onMoved.addListener(bump);
    browser.tabs.onAttached.addListener(bump);
    browser.windows.onRemoved.addListener(bump);
    browser.windows.onCreated.addListener(bump);
    onCleanup(() => {
      browser.tabs.onUpdated.removeListener(bump);
      browser.tabs.onRemoved.removeListener(bump);
      browser.tabs.onCreated.removeListener(bump);
      browser.tabs.onMoved.removeListener(bump);
      browser.tabs.onAttached.removeListener(bump);
      browser.windows.onRemoved.removeListener(bump);
      browser.windows.onCreated.removeListener(bump);
    });
  });

  const run = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggle = (id: string) => {
    const next = new Set(collapsed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const focusTab = (t: TreeTab) =>
    run(() => send({ type: 'cmd.focus', target: { kind: 'tab', tabRowId: t.id }, mode: 'tab' }));
  const focusTopic = (topic: TopicTree) =>
    run(() =>
      send({ type: 'cmd.focus', target: { kind: 'topic', topicId: topic.id }, mode: 'window' }),
    );

  const onDragStart = (e: DragEvent, t: TreeTab) => {
    if (t.chromeTabId === undefined || !e.dataTransfer) return;
    e.dataTransfer.setData(DRAG_MIME, String(t.chromeTabId));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (e: DragEvent, topic: TopicTree) => {
    e.preventDefault();
    setDropTarget(undefined);
    const raw = e.dataTransfer?.getData(DRAG_MIME);
    if (!raw) return;
    const chromeTabId = Number(raw);
    void run(() => send({ type: 'cmd.move', topicId: topic.id, chromeTabIds: [chromeTabId] }));
  };

  const open = () => data()?.topics.filter((t) => t.status === 'open') ?? [];

  const TabRow = (props: { tab: TreeTab }) => (
    <li
      class="tab"
      classList={{ closed: !props.tab.isOpen }}
      draggable={props.tab.isOpen}
      onDragStart={(e) => onDragStart(e, props.tab)}
      onClick={() => void focusTab(props.tab)}
      title={props.tab.url}
    >
      <Show when={props.tab.favicon} fallback={<span class="fav-fallback" />}>
        <img class="fav" src={props.tab.favicon} alt="" width="14" height="14" />
      </Show>
      <span class="title">{props.tab.title || props.tab.url}</span>
    </li>
  );

  const TopicCard = (props: { topic: TopicTree }) => (
    <section
      class="topic"
      classList={{
        current: props.topic.windowId === data()?.currentWindowId,
        saved: props.topic.status === 'saved',
        drop: dropTarget() === props.topic.id,
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes(DRAG_MIME)) {
          e.preventDefault();
          setDropTarget(props.topic.id);
        }
      }}
      onDragLeave={() => dropTarget() === props.topic.id && setDropTarget(undefined)}
      onDrop={(e) => onDrop(e, props.topic)}
    >
      <header>
        <button class="chev" onClick={() => toggle(props.topic.id)} title="접기/펼치기">
          {collapsed().has(props.topic.id) ? '▸' : '▾'}
        </button>
        <button
          class={`dot ${props.topic.color ?? 'none'}`}
          title="색상"
          onClick={() => setColorFor(colorFor() === props.topic.id ? undefined : props.topic.id)}
        />
        <Show
          when={editing() === props.topic.id}
          fallback={
            <button
              class="name"
              classList={{ unnamed: !props.topic.isNamed }}
              onClick={() => {
                setDraft(props.topic.isNamed ? props.topic.name : '');
                setEditing(props.topic.id);
              }}
              title="이름 바꾸기"
            >
              {props.topic.name}
            </button>
          }
        >
          <input
            class="rename"
            value={draft()}
            placeholder={props.topic.name}
            maxLength={50}
            autofocus
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (isCommitEnter(e)) {
                void run(() =>
                  send({ type: 'topic.rename', topicId: props.topic.id, name: draft() }),
                );
                setEditing(undefined);
              }
              if (e.key === 'Escape') setEditing(undefined);
            }}
            onBlur={() => setEditing(undefined)}
          />
        </Show>
        <span class="count">{props.topic.tabCount}</span>
        <button class="go" onClick={() => void focusTopic(props.topic)} title="창으로 이동">
          ↗
        </button>
      </header>
      <Show when={colorFor() === props.topic.id}>
        <div class="palette">
          <For each={COLORS}>
            {(c) => (
              <button
                class={`dot ${c}`}
                classList={{ active: props.topic.color === c }}
                onClick={() => {
                  setColorFor(undefined);
                  void run(() =>
                    send({ type: 'topic.setColor', topicId: props.topic.id, color: c }),
                  );
                }}
                title={c}
              />
            )}
          </For>
          <button
            class="dot none"
            onClick={() => {
              setColorFor(undefined);
              void run(() => send({ type: 'topic.setColor', topicId: props.topic.id }));
            }}
            title="없음"
          />
        </div>
      </Show>
      <Show when={!collapsed().has(props.topic.id)}>
        <For each={props.topic.subgroups}>
          {(g) => (
            <div class="subgroup">
              <div class={`ghead ${g.color ?? 'grey'}`}>
                <span class="gname">{g.name || '(이름 없는 그룹)'}</span>
                <span class="count">{g.tabs.length}</span>
              </div>
              <ul>
                <For each={g.tabs}>{(t) => <TabRow tab={t} />}</For>
              </ul>
            </div>
          )}
        </For>
        <ul>
          <For each={props.topic.tabs}>{(t) => <TabRow tab={t} />}</For>
        </ul>
      </Show>
    </section>
  );

  return (
    <main class="panel">
      <h1>
        주제 <span class="muted">{open().length}</span>
        <Show when={bridgeState() && bridgeState() !== 'stopped'}>
          <span
            class="bridge"
            classList={{ on: bridgeState() === 'connected' }}
            title="데스크톱 앱 연결 (Native Messaging)"
          >
            {bridgeState() === 'connected' ? '● 데스크톱 연결됨' : '○ 데스크톱 미연결'}
          </span>
        </Show>
        <a href="#" class="refresh" onClick={(e) => (e.preventDefault(), refetch())}>
          새로고침
        </a>
      </h1>
      <Show when={data()} fallback={<p class="muted">불러오는 중…</p>}>
        <For each={open()}>{(t) => <TopicCard topic={t} />}</For>
      </Show>
      <section class="rules">
        <h2>
          <button class="chev" onClick={() => setRulesOpen(!rulesOpen())}>
            {rulesOpen() ? '▾' : '▸'}
          </button>
          규칙 <span class="muted">{rules().length}</span>
          <label class="switch">
            <input
              type="checkbox"
              checked={rulesEnabled()}
              onChange={(e) => {
                const enabled = e.currentTarget.checked;
                setRulesEnabled(enabled);
                void run(() => send({ type: 'settings.update', patch: { rulesEnabled: enabled } }));
              }}
            />
            자동 이동
          </label>
        </h2>
        <Show when={rulesOpen()}>
          <ul class="rule-list">
            <For each={rules()}>
              {(r) => (
                <li classList={{ off: !r.enabled }}>
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    title="사용"
                    onChange={(e) =>
                      void run(async () => {
                        const res = await send({
                          type: 'rules.toggle',
                          id: r.id,
                          enabled: e.currentTarget.checked,
                        });
                        if (res.type === 'rules.list') setRules(res.rules);
                      })
                    }
                  />
                  <span class="kind">{r.kind}</span>
                  <span class="pattern" title={r.pattern}>
                    {r.pattern}
                  </span>
                  <span class="arrow">→</span>
                  <span class="target">{r.topicName}</span>
                  <span class="muted small">{r.source === 'learned' ? '학습' : ''}</span>
                  <button
                    class="del"
                    title="삭제"
                    onClick={() =>
                      void run(async () => {
                        const res = await send({ type: 'rules.delete', id: r.id });
                        if (res.type === 'rules.list') setRules(res.rules);
                      })
                    }
                  >
                    ×
                  </button>
                </li>
              )}
            </For>
          </ul>
          <div class="rule-add">
            <select
              value={newKind()}
              onChange={(e) => setNewKind(e.currentTarget.value as RuleKind)}
            >
              <option value="host">host</option>
              <option value="prefix">prefix</option>
              <option value="regex">regex</option>
            </select>
            <input
              placeholder="github.com 또는 github.com/MacTechIN"
              value={newPattern()}
              onInput={(e) => setNewPattern(e.currentTarget.value)}
              onKeyDown={(e) => isCommitEnter(e) && void putRule()}
            />
            <input
              placeholder="주제 이름"
              list="topic-names"
              value={newTopic()}
              onInput={(e) => setNewTopic(e.currentTarget.value)}
              onKeyDown={(e) => isCommitEnter(e) && void putRule()}
            />
            <datalist id="topic-names">
              <For each={open()}>{(t) => <option value={t.name} />}</For>
            </datalist>
            <button onClick={() => void putRule()}>추가</button>
          </div>
          <p class="hint">
            규칙은 주제 <b>이름</b>에 묶입니다. 그 이름의 창이 열려 있을 때만 동작하고, 직접 옮긴
            탭은 건드리지 않습니다.
          </p>
        </Show>
      </section>

      <section class="data">
        <h2>데이터</h2>
        <div class="data-actions">
          <button
            onClick={() => void exportData()}
            title="규칙·설정·현재 주제 스냅샷을 JSON으로 저장"
          >
            내보내기
          </button>
          <label class="file">
            가져오기
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                void importData(f);
              }}
            />
          </label>
          <button class="danger" onClick={() => void resetData()} title="모든 저장 데이터 삭제">
            초기화
          </button>
        </div>
      </section>

      <Show when={error()}>{(e) => <p class="error">{e()}</p>}</Show>
      <p class="hint">
        탭을 끌어 다른 주제에 놓으면 그 창으로 이동합니다 · 이름·색상 클릭으로 편집
      </p>
    </main>
  );
}
