// core/messages.ts — typed runtime messages between popup/sidepanel and the SW.

import type { FocusResult, FocusTarget, MoveResult } from './commandRunner';
import type { LiveState } from './liveState';
import type { Topic } from './model';
import type { SearchHit, SearchScope } from './search/index';
import type { TopicErrorCode, TopicSummary } from './topicService';

export type RuntimeRequest =
  | { type: 'live.get' }
  | { type: 'live.resync' }
  | { type: 'topics.list' }
  | { type: 'topic.rename'; topicId: string; name: string }
  | { type: 'topic.deleteSaved'; topicId: string }
  | { type: 'search'; text: string; scope?: SearchScope; currentWindowId?: number; limit?: number }
  | { type: 'cmd.focus'; target: FocusTarget; mode?: 'tab' | 'window' }
  | { type: 'cmd.move'; topicId: string; chromeTabIds: number[]; switchTo?: boolean }
  | { type: 'cmd.new'; chromeTabIds: number[]; name?: string }
  | { type: 'cmd.rename'; name: string; topicId?: string; windowId?: number }
  | { type: 'cmd.open'; topicId: string }
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

export type RuntimeResponse =
  | LiveGetResponse
  | TopicsListResponse
  | SearchResponse
  | FocusResponse
  | MoveResponse
  | TopicResponse
  | OkResponse
  | ErrorResponse;
