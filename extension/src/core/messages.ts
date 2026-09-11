// core/messages.ts — typed runtime messages between popup/sidepanel and the SW.

import type { LiveState } from './liveState';

export type RuntimeRequest = { type: 'live.get' } | { type: 'live.resync' };

export interface LiveGetResponse {
  type: 'live.state';
  state: LiveState;
  startedAt: number;
}

export type RuntimeResponse = LiveGetResponse;
