// core/messages.ts — typed runtime messages between popup/sidepanel and the SW.

import type { BridgeStatus } from '../bridge/client';
import type { AutoMove, UndoResult } from './autoMover';
import type { ImportResult } from './exportImport';
import type { FocusResult, FocusTarget, MoveResult } from './commandRunner';
import type { LiveState } from './liveState';
import type { Rule, RuleKind, Topic, TopicColor } from './model';
import type { RuleSuggestion } from './ruleSuggest';
import type { Settings } from './settings';
import type { SearchHit, SearchScope } from './search/index';
import type { TopicErrorCode, TopicSummary, TopicTree } from './topicService';

export interface TreeResponse {
  type: 'sidepanel.tree';
  topics: TopicTree[];
}

export type RuntimeRequest =
  | { type: 'live.get' }
  | { type: 'live.resync' }
  | { type: 'debug.stats' }
  | { type: 'topics.list' }
  | { type: 'topic.rename'; topicId: string; name: string }
  | { type: 'topic.deleteSaved'; topicId: string }
  | { type: 'topic.setColor'; topicId: string; color?: TopicColor }
  | { type: 'sidepanel.tree' }
  | { type: 'search'; text: string; scope?: SearchScope; currentWindowId?: number; limit?: number }
  | { type: 'cmd.focus'; target: FocusTarget; mode?: 'tab' | 'window' }
  | { type: 'cmd.move'; topicId: string; chromeTabIds: number[]; switchTo?: boolean }
  | { type: 'cmd.new'; chromeTabIds: number[]; name?: string }
  | { type: 'cmd.rename'; name: string; topicId?: string; windowId?: number }
  | { type: 'cmd.merge'; topicId: string; fromWindowId: number }
  | { type: 'cmd.close'; topicId?: string; windowId?: number }
  | { type: 'data.export' }
  | { type: 'data.import'; text: string }
  | { type: 'data.reset' }
  | { type: 'rules.list' }
  | { type: 'rules.put'; kind: RuleKind; pattern: string; topicName: string; id?: string }
  | { type: 'rules.toggle'; id: string; enabled: boolean }
  | { type: 'rules.delete'; id: string }
  | { type: 'rules.suggestions' }
  | { type: 'rules.accept'; key: string }
  | { type: 'rules.dismiss'; key: string }
  | { type: 'settings.get' }
  | { type: 'settings.update'; patch: Partial<Settings> }
  | { type: 'automove.recent'; withinMs?: number }
  | { type: 'automove.undo'; id: string }
  | { type: 'bridge.status' }
  | { type: 'bridge.reconnect' };

export interface LiveGetResponse {
  type: 'live.state';
  state: LiveState;
  startedAt: number;
}

export interface TopicsListResponse {
  type: 'topics.list';
  topics: TopicSummary[];
}

export interface SearchResponse {
  type: 'search';
  hits: SearchHit[];
}

export interface FocusResponse {
  type: 'focus';
  result: FocusResult;
}

export interface MoveResponse {
  type: 'move';
  result: MoveResult;
}

export interface TopicResponse {
  type: 'topic';
  topic: Topic;
}

export interface OkResponse {
  type: 'ok';
}

export interface ErrorResponse {
  type: 'error';
  code: TopicErrorCode | 'internal' | 'unsupported';
  message: string;
}

export interface DebugStatsResponse {
  type: 'debug.stats';
  topics: number;
  openTopics: number;
  tabs: number;
  openTabs: number;
  indexSize: number;
  indexDirty: boolean;
  liveWindows: number;
  liveTabs: number;
  seq: number;
  freshSession?: boolean;
  startedAt: number;
  /** chrome.storage.local bytes in use (quota is 10 MB without unlimitedStorage). */
  bytesInUse?: number;
  errors: string[];
}

export interface RulesListResponse {
  type: 'rules.list';
  rules: Rule[];
}

export interface SuggestionsResponse {
  type: 'rules.suggestions';
  suggestions: RuleSuggestion[];
}

export interface SettingsResponse {
  type: 'settings';
  settings: Settings;
}

export interface AutoMovesResponse {
  type: 'automove.recent';
  moves: AutoMove[];
}

export interface UndoResponse {
  type: 'automove.undo';
  result: UndoResult;
}

export interface CloseResponse {
  type: 'close';
  result: { topicId: string; name: string; windowId: number; tabs: number };
}

export interface ExportResponse {
  type: 'data.export';
  text: string;
  filename: string;
}

export interface ImportResponse {
  type: 'data.import';
  result: ImportResult;
}

export interface BridgeStatusResponse {
  type: 'bridge.status';
  status: BridgeStatus;
}

export type RuntimeResponse =
  | CloseResponse
  | ExportResponse
  | ImportResponse
  | BridgeStatusResponse
  | RulesListResponse
  | SuggestionsResponse
  | SettingsResponse
  | AutoMovesResponse
  | UndoResponse
  | LiveGetResponse
  | TopicsListResponse
  | DebugStatsResponse
  | TreeResponse
  | SearchResponse
  | FocusResponse
  | MoveResponse
  | TopicResponse
  | OkResponse
  | ErrorResponse;
