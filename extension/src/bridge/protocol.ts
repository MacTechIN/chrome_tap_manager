// bridge/protocol.ts — extension-side types for protocol/bridge.schema.json (v0.1).
// Hand-written on purpose (each app owns its types); tests/bridge/protocol.test.ts keeps the
// message list in sync with the schema. Do not import anything from ../../protocol at runtime.

export const PROTOCOL_VERSION = '0.1.0';
/** Native messaging host name registered by bridge/ (must match its manifest `name`). */
export const HOST_NAME = 'com.mactechin.chrome_tap_manager';
/** host→ext frames are capped at 1 MB; snapshots are paged by tab count. */
export const SNAPSHOT_PAGE_SIZE = 200;

export type Browser = 'chrome' | 'edge' | 'brave' | 'chromium';

export interface ProtoTopic {
  id: string;
  name: string;
  isNamed: boolean;
  color?: string;
  windowId: number;
  tabCount: number;
  lastActiveAt: number;
}

export interface ProtoWindow {
  id: number;
  focused: boolean;
  topicId: string;
  title?: string;
}

export interface ProtoTab {
  id: number;
  rowId?: string;
  windowId: number;
  topicId: string;
  index: number;
  url: string;
  title: string;
  favicon?: string;
  active: boolean;
  groupId?: number;
  lastActiveAt?: number;
}

export interface ProtoGroup {
  id: number;
  windowId: number;
  title: string;
  color: string;
  collapsed: boolean;
}

export interface Hello {
  type: 'hello';
  protocolVersion: string;
  extVersion: string;
  browser: Browser;
  lastSeq: number;
}
export interface SnapshotRequest {
  type: 'snapshot_request';
}
export interface Snapshot {
  type: 'snapshot';
  page: number;
  pages: number;
  seq: number;
  topics: ProtoTopic[];
  windows: ProtoWindow[];
  tabs: ProtoTab[];
  groups: ProtoGroup[];
}
export interface Delta {
  type: 'delta';
  seq: number;
  event: { type: string } & Record<string, unknown>;
}
export interface Focus {
  type: 'focus';
  requestId: string;
  windowId: number;
  tabId?: number;
}
export interface FocusResult {
  type: 'focus_result';
  requestId: string;
  ok: boolean;
  windowId?: number;
  windowTitle?: string;
  error?: string;
}
export interface Move {
  type: 'move';
  requestId: string;
  tabIds: number[];
  topicId: string;
  switchTo?: boolean;
}
export interface NewTopic {
  type: 'new_topic';
  requestId: string;
  tabIds: number[];
  name?: string;
}
export interface Rename {
  type: 'rename';
  requestId: string;
  topicId: string;
  name: string;
}
export interface Close {
  type: 'close';
  requestId: string;
  topicId: string;
}
export interface TopicsUpdate {
  type: 'topics_update';
  seq: number;
  requestId?: string;
  ok?: boolean;
  error?: string;
  topics: ProtoTopic[];
}
export interface Ping {
  type: 'ping';
}
export interface Pong {
  type: 'pong';
}

export type BridgeMessage =
  | Hello
  | SnapshotRequest
  | Snapshot
  | Delta
  | Focus
  | FocusResult
  | Move
  | NewTopic
  | Rename
  | Close
  | TopicsUpdate
  | Ping
  | Pong;

export type BridgeMessageType = BridgeMessage['type'];

/** Every message type, in schema order — compared against the schema in tests. */
export const MESSAGE_TYPES: readonly BridgeMessageType[] = [
  'hello',
  'snapshot_request',
  'snapshot',
  'delta',
  'focus',
  'focus_result',
  'move',
  'new_topic',
  'rename',
  'close',
  'topics_update',
  'ping',
  'pong',
];

export function isBridgeMessage(x: unknown): x is BridgeMessage {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { type?: unknown }).type === 'string' &&
    (MESSAGE_TYPES as readonly string[]).includes((x as { type: string }).type)
  );
}
