// bridge/client.ts — BridgeClient: the extension's end of the native-messaging link.
//   • opens the port, sends `hello`, keeps it open (an open native port keeps the MV3
//     service worker alive — research.md),
//   • answers snapshot_request / focus / move / new_topic / rename / close / ping,
//   • pushes `delta` for every live event and `topics_update` (debounced) on topic changes,
//   • reconnects with exponential backoff; a missing host is a quiet "disconnected" state.
// Nothing here touches Chrome directly: transport + handlers are injected.

import {
  type BridgeMessage,
  type Browser,
  type Focus,
  HOST_NAME,
  isBridgeMessage,
  PROTOCOL_VERSION,
  type ProtoGroup,
  type ProtoTab,
  type ProtoTopic,
  type ProtoWindow,
  SNAPSHOT_PAGE_SIZE,
} from './protocol';
import type { BridgePort, BridgeTransport } from './transport';

export interface SnapshotData {
  seq: number;
  topics: ProtoTopic[];
  windows: ProtoWindow[];
  tabs: ProtoTab[];
  groups: ProtoGroup[];
}

export interface BridgeHandlers {
  snapshot(): SnapshotData;
  topics(): ProtoTopic[];
  seq(): number;
  focus(windowId: number, tabId?: number): Promise<{ windowId: number; windowTitle?: string }>;
  move(tabIds: number[], topicId: string, switchTo?: boolean): Promise<void>;
  newTopic(tabIds: number[], name?: string): Promise<void>;
  rename(topicId: string, name: string): Promise<void>;
  close(topicId: string): Promise<void>;
}

export type BridgeState = 'stopped' | 'connecting' | 'connected' | 'disconnected';

export interface BridgeStatus {
  state: BridgeState;
  hostName: string;
  attempts: number;
  lastError?: string;
  connectedAt?: number;
  lastSeqSent?: number;
  nextRetryMs?: number;
}

export interface BridgeClientOptions {
  transport: BridgeTransport;
  handlers: BridgeHandlers;
  extVersion: string;
  browser?: Browser;
  hostName?: string;
  backoffInitialMs?: number;
  backoffMaxMs?: number;
  topicsDebounceMs?: number;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  log?: (msg: string, data?: unknown) => void;
}

export class BridgeClient {
  private readonly t: BridgeTransport;
  private readonly h: BridgeHandlers;
  private readonly hostName: string;
  private readonly extVersion: string;
  private readonly browser: Browser;
  private readonly backoffInitialMs: number;
  private readonly backoffMaxMs: number;
  private readonly topicsDebounceMs: number;
  private readonly now: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly log?: (msg: string, data?: unknown) => void;

  private port: BridgePort | undefined;
  private state: BridgeState = 'stopped';
  private attempts = 0;
  private lastError: string | undefined;
  private connectedAt: number | undefined;
  private lastSeqSent: number | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private nextRetryMs: number | undefined;
  private topicsTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: BridgeClientOptions) {
    this.t = opts.transport;
    this.h = opts.handlers;
    this.hostName = opts.hostName ?? HOST_NAME;
    this.extVersion = opts.extVersion;
    this.browser = opts.browser ?? 'chrome';
    this.backoffInitialMs = opts.backoffInitialMs ?? 1_000;
    this.backoffMaxMs = opts.backoffMaxMs ?? 60_000;
    this.topicsDebounceMs = opts.topicsDebounceMs ?? 300;
    this.now = opts.now ?? (() => Date.now());
    this.setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
    this.log = opts.log;
  }

  status(): BridgeStatus {
    return {
      state: this.state,
      hostName: this.hostName,
      attempts: this.attempts,
      lastError: this.lastError,
      connectedAt: this.connectedAt,
      lastSeqSent: this.lastSeqSent,
      nextRetryMs: this.nextRetryMs,
    };
  }

  get connected(): boolean {
    return this.state === 'connected';
  }

  start(): void {
    if (this.state !== 'stopped') return;
    this.attempts = 0;
    this.connect();
  }

  stop(): void {
    this.clearRetry();
    if (this.topicsTimer !== undefined) this.clearTimeoutFn(this.topicsTimer);
    this.topicsTimer = undefined;
    this.port?.disconnect();
    this.port = undefined;
    this.state = 'stopped';
  }

  /** Forward a live event as a delta (no-op while disconnected). */
  onLiveEvent(event: { type: string } & Record<string, unknown>, seq: number): void {
    if (!this.connected) return;
    this.send({ type: 'delta', seq, event });
    this.lastSeqSent = seq;
  }

  /** Topics changed: push the list, debounced. */
  topicsChanged(): void {
    if (!this.connected) return;
    if (this.topicsTimer !== undefined) return;
    this.topicsTimer = this.setTimeoutFn(() => {
      this.topicsTimer = undefined;
      if (this.connected) this.sendTopics();
    }, this.topicsDebounceMs);
  }

  // ---- connection ---------------------------------------------------------

  private connect(): void {
    this.clearRetry();
    this.state = 'connecting';
    let port: BridgePort;
    try {
      port = this.t.connect(this.hostName);
    } catch (err) {
      this.onDisconnected(err instanceof Error ? err.message : String(err));
      return;
    }
    this.port = port;
    port.onMessage((m) => this.onMessage(m));
    port.onDisconnect((error) => {
      if (this.port !== port) return; // stale port
      this.onDisconnected(error);
    });
    // Chrome gives no "opened" event; the first successful post is the handshake.
    this.state = 'connected';
    this.connectedAt = this.now();
    this.lastError = undefined;
    this.send({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      extVersion: this.extVersion,
      browser: this.browser,
      lastSeq: this.h.seq(),
    });
    this.log?.('bridge connected (hello sent)', { host: this.hostName });
  }

  private onDisconnected(error?: string): void {
    const wasConnected = this.state === 'connected';
    this.port = undefined;
    this.state = 'disconnected';
    this.lastError = error;
    this.connectedAt = undefined;
    // A port that stayed up for a while counts as a real session: restart the backoff.
    if (wasConnected && error === undefined) this.attempts = 0;
    this.attempts += 1;
    const delay = Math.min(
      this.backoffMaxMs,
      this.backoffInitialMs * 2 ** Math.min(20, this.attempts - 1),
    );
    this.nextRetryMs = delay;
    this.log?.('bridge disconnected', { error, retryInMs: delay, attempts: this.attempts });
    this.retryTimer = this.setTimeoutFn(() => {
      this.retryTimer = undefined;
      this.nextRetryMs = undefined;
      if (this.state === 'disconnected') this.connect();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer !== undefined) this.clearTimeoutFn(this.retryTimer);
    this.retryTimer = undefined;
    this.nextRetryMs = undefined;
  }

  private send(msg: BridgeMessage): void {
    try {
      this.port?.post(msg);
    } catch (err) {
      this.log?.('bridge post failed', err);
      this.onDisconnected(err instanceof Error ? err.message : String(err));
    }
  }

  // ---- inbound ------------------------------------------------------------

  private onMessage(raw: unknown): void {
    if (!isBridgeMessage(raw)) {
      this.log?.('bridge: ignoring unknown message', raw);
      return;
    }
    switch (raw.type) {
      case 'ping':
        this.send({ type: 'pong' });
        return;
      case 'pong':
      case 'hello':
      case 'snapshot':
      case 'delta':
      case 'focus_result':
      case 'topics_update':
        return; // ext→app messages echoed back: ignore
      case 'snapshot_request':
        this.sendSnapshot();
        return;
      case 'focus':
        void this.handleFocus(raw);
        return;
      case 'move':
        void this.handleCommand(raw.requestId, () =>
          this.h.move(raw.tabIds, raw.topicId, raw.switchTo),
        );
        return;
      case 'new_topic':
        void this.handleCommand(raw.requestId, () => this.h.newTopic(raw.tabIds, raw.name));
        return;
      case 'rename':
        void this.handleCommand(raw.requestId, () => this.h.rename(raw.topicId, raw.name));
        return;
      case 'close':
        void this.handleCommand(raw.requestId, () => this.h.close(raw.topicId));
        return;
    }
  }

  private async handleFocus(msg: Focus): Promise<void> {
    try {
      const r = await this.h.focus(msg.windowId, msg.tabId);
      this.send({
        type: 'focus_result',
        requestId: msg.requestId,
        ok: true,
        windowId: r.windowId,
        windowTitle: r.windowTitle,
      });
    } catch (err) {
      this.send({
        type: 'focus_result',
        requestId: msg.requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleCommand(requestId: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.sendTopics({ requestId, ok: true });
    } catch (err) {
      this.sendTopics({
        requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private sendTopics(extra: { requestId?: string; ok?: boolean; error?: string } = {}): void {
    this.send({ type: 'topics_update', seq: this.h.seq(), topics: this.h.topics(), ...extra });
  }

  private sendSnapshot(): void {
    const data = this.h.snapshot();
    const pages = Math.max(1, Math.ceil(data.tabs.length / SNAPSHOT_PAGE_SIZE));
    for (let page = 1; page <= pages; page++) {
      const start = (page - 1) * SNAPSHOT_PAGE_SIZE;
      this.send({
        type: 'snapshot',
        page,
        pages,
        seq: data.seq,
        // topics/windows/groups are small: repeat them on every page so each page is self-contained.
        topics: data.topics,
        windows: data.windows,
        groups: data.groups,
        tabs: data.tabs.slice(start, start + SNAPSHOT_PAGE_SIZE),
      });
    }
    this.lastSeqSent = data.seq;
  }
}
