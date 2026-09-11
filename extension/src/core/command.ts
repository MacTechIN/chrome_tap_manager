// core/command.ts — search-box input grammar (spec F-07 modes, F-02/F-09 commands).
//
//   <text>               search everything
//   #<topic> <text>      search inside one topic
//   @saved <text>        saved topics / saved tabs only
//   ><cmd> <arg>         command mode: move | new | rename | open | close | save | merge
//
// Pure: no Chrome, no Repo. Callers pass topic refs for argument completion.

import { matchVariants } from './search/fuzzy';
import { variants } from './search/hangul';

export const COMMANDS = ['move', 'new', 'rename', 'open', 'close', 'save', 'merge'] as const;
export type CommandName = (typeof COMMANDS)[number];

export type ArgKind = 'topic' | 'savedTopic' | 'name' | 'optionalTopic' | 'none';

export interface CommandInfo {
  arg: ArgKind;
  description: string;
  usage: string;
}

export const COMMAND_INFO: Record<CommandName, CommandInfo> = {
  move: { arg: 'topic', description: '현재 탭을 주제로 보내기', usage: '>move <주제>' },
  new: { arg: 'name', description: '현재 탭으로 새 주제 만들기', usage: '>new <이름>' },
  rename: { arg: 'name', description: '현재 주제 이름 바꾸기', usage: '>rename <이름>' },
  open: { arg: 'savedTopic', description: '저장된 주제를 창으로 열기', usage: '>open <주제>' },
  close: { arg: 'optionalTopic', description: '주제 창 닫기 (저장됨)', usage: '>close [주제]' },
  save: { arg: 'none', description: '현재 창의 탭 목록 저장', usage: '>save' },
  merge: { arg: 'topic', description: '현재 창을 다른 주제에 합치기', usage: '>merge <주제>' },
};

export type ParsedInput =
  | { mode: 'search'; text: string }
  | { mode: 'saved'; text: string }
  | { mode: 'topic'; topicQuery: string; text: string }
  | {
      mode: 'command';
      /** Resolved command, when the first token is a command or an unambiguous prefix followed by a space. */
      command?: CommandName;
      /** Raw first token after '>' (may be partial). */
      partial: string;
      /** Everything after the first token. */
      arg: string;
      /** True once the user typed a space after the command token. */
      hasSpace: boolean;
    };

export function matchCommands(partial: string): CommandName[] {
  const p = partial.trim().toLowerCase();
  return COMMANDS.filter((c) => c.startsWith(p));
}

export function parseInput(raw: string): ParsedInput {
  const s = raw.replace(/^\s+/, '');
  if (s.startsWith('>')) {
    const body = s.slice(1).replace(/^\s+/, '');
    const m = /^(\S*)(\s*)([\s\S]*)$/.exec(body)!;
    const partial = m[1]!.toLowerCase();
    const hasSpace = m[2]!.length > 0;
    const arg = m[3]!.trim();
    let command: CommandName | undefined;
    if ((COMMANDS as readonly string[]).includes(partial)) {
      command = partial as CommandName;
    } else if (hasSpace) {
      const c = matchCommands(partial);
      if (c.length === 1) command = c[0];
    }
    return { mode: 'command', command, partial, arg, hasSpace };
  }
  if (s.startsWith('@saved')) {
    return { mode: 'saved', text: s.slice('@saved'.length).trim() };
  }
  if (s.startsWith('#')) {
    const m = /^#(\S*)\s*([\s\S]*)$/.exec(s)!;
    return { mode: 'topic', topicQuery: m[1]!, text: m[2]!.trim() };
  }
  return { mode: 'search', text: s.trim() };
}

export interface TopicRef {
  id: string;
  name: string;
  status: 'open' | 'saved';
  windowId?: number;
}

export interface CommandSuggestion {
  command: CommandName;
  /** Present for topic-argument commands once a topic is chosen. */
  topic?: TopicRef;
  /** Present for name-argument commands (the typed name). */
  arg?: string;
  /** What to show in the list. */
  label: string;
  /** What the input becomes when the suggestion is accepted (Tab). */
  fill: string;
  /** True when the suggestion can be executed as-is (Enter). */
  complete: boolean;
  description: string;
}

/**
 * Suggestions for command mode.
 *   ">"          → all commands
 *   ">mo"        → commands starting with "mo"
 *   ">move 프"   → move + topics matching "프" (Hangul-aware, fuzzy)
 */
export function suggestCommands(
  parsed: Extract<ParsedInput, { mode: 'command' }>,
  topics: readonly TopicRef[],
  opts: { limit?: number; currentTopicId?: string } = {},
): CommandSuggestion[] {
  const limit = opts.limit ?? 8;

  if (!parsed.command) {
    return matchCommands(parsed.partial)
      .slice(0, limit)
      .map((c) => ({
        command: c,
        label: COMMAND_INFO[c].usage,
        fill: `>${c} `,
        complete: COMMAND_INFO[c].arg === 'none',
        description: COMMAND_INFO[c].description,
      }));
  }

  const cmd = parsed.command;
  const info = COMMAND_INFO[cmd];

  switch (info.arg) {
    case 'none':
      return [
        {
          command: cmd,
          label: info.usage,
          fill: `>${cmd}`,
          complete: true,
          description: info.description,
        },
      ];

    case 'name': {
      const name = parsed.arg;
      return [
        {
          command: cmd,
          arg: name,
          label: name ? `>${cmd} ${name}` : info.usage,
          fill: `>${cmd} ${name}`,
          complete: name.length > 0,
          description: info.description,
        },
      ];
    }

    case 'topic':
    case 'savedTopic':
    case 'optionalTopic': {
      const pool = topics.filter((t) => {
        if (info.arg === 'savedTopic') return t.status === 'saved';
        if (cmd === 'move' || cmd === 'merge') return t.id !== opts.currentTopicId;
        return true;
      });
      const ranked = rankTopics(parsed.arg, pool).slice(0, limit);
      const out: CommandSuggestion[] = ranked.map((t) => ({
        command: cmd,
        topic: t,
        label: `>${cmd} ${t.name}`,
        fill: `>${cmd} ${t.name}`,
        complete: true,
        description: `${info.description}${t.status === 'saved' ? ' · 저장됨' : ''}`,
      }));
      if (info.arg === 'optionalTopic' && parsed.arg.length === 0) {
        out.unshift({
          command: cmd,
          label: `>${cmd}`,
          fill: `>${cmd}`,
          complete: true,
          description: `${info.description} — 현재 창`,
        });
      }
      return out;
    }
  }
}

/** Topics ordered by how well `query` matches their names; empty query keeps input order. */
export function rankTopics<T extends { name: string }>(query: string, topics: readonly T[]): T[] {
  const q = query.trim();
  if (!q) return [...topics];
  const scored: { t: T; s: number }[] = [];
  for (const t of topics) {
    const m = matchVariants(q, variants(t.name));
    if (m) scored.push({ t, s: m.score });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.t);
}

/** Exact topic by name (case/space-insensitive). */
export function findTopicByName<T extends { name: string }>(
  name: string,
  topics: readonly T[],
): T | undefined {
  const key = variants(name).raw;
  return topics.find((t) => variants(t.name).raw === key);
}
