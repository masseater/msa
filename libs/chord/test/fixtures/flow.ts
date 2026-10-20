import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import chord from "../../src/index.ts";
import type chordTypes from "../../src/index.types.ts";
import type flowTypes from "./flow.types.ts";
import timing from "./timing.ts";

const { createHost, hostNamed, memoryLinkPair, method, remote } = chord;

const { latch, pollUntil } = timing;

const until = (check: () => boolean): Effect.Effect<void> => pollUntil(check, 200, Effect.sleep(2));

class AckGate implements chordTypes.Link {
  readonly inner: chordTypes.Link;
  readonly received: chordTypes.Frame[] = [];
  paused = false;
  #held: chordTypes.Frame | undefined;
  constructor(inner: chordTypes.Link) {
    this.inner = inner;
  }
  get closed(): boolean {
    return this.inner.closed;
  }
  send(frame: chordTypes.Frame): number | undefined {
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
  receive(handler: (frame: chordTypes.Frame) => void): void {
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
    host: hostNamed(host),
    input: Type.Object({}),
    variants: {
      main: {
        methods: { add: method(Type.Number(), Type.Number()), wait: method() },
        state: { count: Type.Object({ n: Type.Number() }) },
      },
    },
    version: 1,
  });
const Counter = counterOn("t.flow-counter", "server");
const WorkerCounter = counterOn("t.flow-worker-counter", "w");

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

const resetWaiting = (): void => {
  waits.release = () => {};
};

const releaseWaiting = (): void => {
  waits.release();
};

function serveCounterImpl(host: chordTypes.Host, type = Counter): void {
  host.serve(type, (_input, _principal, self) => {
    const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
    return {
      add: (delta: number, ctx: chordTypes.Ctx) => {
        count.change(ctx, (draft) => {
          draft.n += delta;
        });
        return count.value.n;
      },
      count,
      variant: "main",
      wait: waiting,
    };
  });
}

function clientImpl(server: chordTypes.Host, window: number): flowTypes.FlowClient {
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { user: "u" }, window });
  const gate = new AckGate(up);
  const host = createHost({
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: gate, principal: { kind: "server" } },
  });
  return { gate, host };
}

const stateFrames = (frames: readonly chordTypes.Frame[]) =>
  frames.filter((frame): frame is Extract<chordTypes.Frame, { t: "state" }> => frame.t === "state");

const isHost = (value: unknown): value is chordTypes.Host =>
  typeof (value as { serve?: unknown } | undefined)?.serve === "function";

const serveCounter: {
  (type?: typeof Counter): (host: chordTypes.Host) => void;
  (host: chordTypes.Host, type?: typeof Counter): void;
} = dual((args: IArguments) => isHost(args[0]), serveCounterImpl);

const client: {
  (window: number): (server: chordTypes.Host) => flowTypes.FlowClient;
  (server: chordTypes.Host, window: number): flowTypes.FlowClient;
} = dual(2, clientImpl);

const flow = {
  AckGate,
  Counter,
  WorkerCounter,
  client,
  releaseWaiting,
  resetWaiting,
  serveCounter,
  stateFrames,
  until,
};

export default flow;
