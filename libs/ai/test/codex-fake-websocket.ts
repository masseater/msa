import { vi } from "vite-plus/test";

type Listener = (event: unknown) => void;

interface FakeSocketRecord {
  closed: boolean;
  readonly headers: Record<string, string>;
  readonly id: number;
  readonly sent: Array<Record<string, unknown>>;
}

interface FakeSocketScript {
  readonly open?: boolean;
  readonly reply?: (
    sent: Record<string, unknown>,
    socket: FakeSocketRecord,
    all: readonly Record<string, unknown>[],
  ) => readonly unknown[] | "error" | undefined;
}

const state: {
  records: FakeSocketRecord[];
  script: FakeSocketScript;
  sent: Array<Record<string, unknown>>;
} = {
  records: [],
  script: {},
  sent: [],
};

const headersOf = (protocols: unknown): Record<string, string> =>
  typeof protocols === "object" && protocols !== null && !Array.isArray(protocols)
    ? ((protocols as { headers?: Record<string, string> }).headers ?? {})
    : {};

class FakeWebSocket {
  static readonly CLOSED = 3;
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly record: FakeSocketRecord;

  constructor(_url: string, protocols?: unknown) {
    this.record = {
      closed: false,
      headers: headersOf(protocols),
      id: state.records.length + 1,
      sent: [],
    };
    state.records.push(this.record);
    if (state.script.open !== false) queueMicrotask(() => this.dispatch("open", {}));
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    if (state.script.open === false)
      throw new Error("send should not be called before websocket open");
    const body = JSON.parse(data) as Record<string, unknown>;
    this.record.sent.push(body);
    state.sent.push(body);
    const events = state.script.reply?.(body, this.record, state.sent);
    queueMicrotask(() => {
      if (events === "error") {
        this.dispatch("error", { message: "fake websocket failed" });
        return;
      }
      for (const event of events ?? []) this.dispatch("message", { data: JSON.stringify(event) });
    });
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.record.closed = true;
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const installFakeWebSocket = (script: FakeSocketScript) => {
  state.records = [];
  state.sent = [];
  state.script = script;
  vi.stubGlobal("WebSocket", FakeWebSocket);
  return { records: state.records, sent: state.sent };
};

const completedResponse = (id: string, extra: object = {}) => ({
  response: {
    id,
    status: "completed",
    usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
    ...extra,
  },
  type: "response.completed",
});

const codexFakeWebSocket = { completedResponse, installFakeWebSocket };

export default codexFakeWebSocket;
