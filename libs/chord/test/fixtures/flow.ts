import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import {
  type Ctx,
  createHost,
  type Frame,
  type Host,
  hostNamed,
  type Link,
  memoryLinkPair,
  method,
  remote,
} from "../../src/index.ts";
import { latch, pollUntil } from "./timing.ts";

export const until = (check: () => boolean): Effect.Effect<void> =>
  pollUntil(check, 200, Effect.sleep(2));

export interface FlowClient {
  readonly host: Host;
  readonly gate: AckGate;
}

export class AckGate implements Link {
  readonly inner: Link;
  readonly received: Frame[] = [];
  paused = false;
  #held: Frame | undefined;
  constructor(inner: Link) {
    this.inner = inner;
  }
  get closed(): boolean {
    return this.inner.closed;
  }
  send(frame: Frame): number | undefined {
    if (frame.t === "ack" && this.paused) {
      this.#held = frame;
      return 0;
    }
    return this.inner.send(frame);
  }
  release(): void {
    this.paused = false;
    if (this.#held !== undefined) this.inner.send(this.#held);
    this.#held = undefined;
  }
  receive(handler: (frame: Frame) => void): void {
    this.inner.receive((frame) => {
      this.received.push(frame);
      handler(frame);
    });
  }
  onClose(handler: (reason: string) => void): void {
    this.inner.onClose(handler);
  }
  close(reason?: string): void {
    this.inner.close(reason);
  }
}

const counterOn = (name: string, host: string) =>
  remote(name, {
    version: 1,
    input: Type.Object({}),
    host: hostNamed(host),
    variants: {
      main: {
        state: { count: Type.Object({ n: Type.Number() }) },
        methods: { add: method(Type.Number(), Type.Number()), wait: method() },
      },
    },
  });
export const Counter = counterOn("t.flow-counter", "server");
export const WorkerCounter = counterOn("t.flow-worker-counter", "w");

const waits = { release: () => {} };
const waiting = () => {
  const gate = latch();
  const previous = waits.release;
  waits.release = () => {
    previous();
    gate.open();
  };
  return gate.promise;
};

export const resetWaiting = (): void => {
  waits.release = () => {};
};

export const releaseWaiting = (): void => {
  waits.release();
};

function serveCounterImpl(host: Host, type = Counter): void {
  host.serve(type, (_input, _principal, self) => {
    const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
    return {
      variant: "main",
      count,
      add: (delta: number, ctx: Ctx) => {
        count.change(ctx, (draft) => {
          draft.n += delta;
        });
        return count.value.n;
      },
      wait: waiting,
    };
  });
}

function clientImpl(server: Host, window: number): FlowClient {
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { user: "u" }, window });
  const gate = new AckGate(up);
  const host = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link: gate, principal: { kind: "server" } },
    onError: () => {},
  });
  return { host, gate };
}

export const stateFrames = (frames: readonly Frame[]) =>
  frames.filter((frame): frame is Extract<Frame, { t: "state" }> => frame.t === "state");

const isHost = (value: unknown): value is Host =>
  typeof (value as { serve?: unknown } | undefined)?.serve === "function";

export const serveCounter: {
  (type?: typeof Counter): (host: Host) => void;
  (host: Host, type?: typeof Counter): void;
} = dual((args: IArguments) => isHost(args[0]), serveCounterImpl);

export const client: {
  (window: number): (server: Host) => FlowClient;
  (server: Host, window: number): FlowClient;
} = dual(2, clientImpl);
