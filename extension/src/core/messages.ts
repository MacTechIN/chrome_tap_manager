// core/messages.ts — typed runtime messages between popup/sidepanel and the SW.

import type { FocusResult, FocusTarget, MoveResult } from './commandRunner';
import type { LiveState } from './liveState';
import type { Topic, TopicColor } from './model';
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
  | { type: 'cmd.merge'; topicId: string; fromWindowId: number };

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

export type RuntimeResponse =
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
