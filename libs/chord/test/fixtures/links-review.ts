import { type Context, Effect } from "effect";
import { Type } from "typebox";

import {
  type Ctx,
  type Frame,
  type Host,
  type Link,
  PROTOCOL_VERSION,
  createHost,
  hostNamed,
  memoryLinkPair,
  method,
  remote,
} from "../../src/index.ts";
import timing from "./timing.ts";
import type timingTypes from "./timing.types.ts";

const { latch, pollUntil } = timing;

const until = pollUntil(100, Effect.sleep(2));

class WatchedLink implements Link {
  readonly inner: Link;
  readonly sent: Frame[] = [];
  closeOn: ((frame: Frame) => boolean) | undefined;
  constructor(inner: Link) {
    this.inner = inner;
  }
  get closed(): boolean {
    return this.inner.closed;
  }
  send(frame: Frame): number | undefined {
    this.sent.push(frame);
    if (this.closeOn?.(frame) === true) {
      this.inner.close("dropped");
      return undefined;
    }
    return this.inner.send(frame);
  }
  receive(handler: (frame: Frame) => void): void {
    this.inner.receive(handler);
  }
  onClose(handler: (reason: string) => void): void {
    this.inner.onClose(handler);
  }
  close(reason?: string): void {
    this.inner.close(reason);
  }
}

const Counter = remote("t.counter", {
  host: hostNamed("session:S1"),
  input: Type.Object({ name: Type.String() }),
  variants: {
    main: {
      methods: {
        add: method(Type.Number(), Type.Number()),
        slow: method(),
        who: method(undefined, Type.Unknown()),
      },
      state: { count: Type.Object({ n: Type.Number() }) },
    },
  },
  version: 1,
});

const browserOn =
  (server: Host) => (principal: unknown, restamp?: (p: unknown) => unknown | undefined) => {
    const [down, up] = memoryLinkPair();
    server.accept(down, { principal, ...(restamp === undefined ? {} : { restamp }) });
    return {
      host: createHost({
        kind: "client",
        name: "browser",
        onError: () => {},
        self: { kind: "host" },
        upstream: { link: up, principal: { kind: "server" } },
      }),
      up,
    };
  };

const rawOn = (server: Host) => (principal: unknown) => {
  const [down, raw] = memoryLinkPair();
  server.accept(down, { principal });
  const frames: Frame[] = [];
  raw.receive((frame) => frames.push(frame));
  raw.send({
    codeVersion: 0,
    kind: "client",
    name: "raw",
    protocol: PROTOCOL_VERSION,
    t: "hello",
  });
  return { frames, raw };
};

interface CounterEnv {
  readonly principals: unknown[];
  readonly log: string[];
  readonly slowGate: () => timingTypes.Latch;
  readonly services: Context.Context<never>;
}

const serveReviewCounter = (worker: Host, env: CounterEnv): void => {
  const { principals, log, services } = env;
  worker.serve(Counter, (input, principal, self) => {
    principals.push(principal);
    self.resource("probe", {
      close: () => void log.push(`close ${input.name}`),
      open: () => void log.push(`open ${input.name}`),
      version: 1,
    });
    const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
    return {
      add: (delta: number, ctx: Ctx) => {
        count.change(ctx, (draft) => {
          draft.n += delta;
        });
        return count.value.n;
      },
      count,
      slow: (ctx: Ctx) =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            ctx.signal.addEventListener("abort", () => log.push("slow aborted"));
            yield* Effect.promise(() => env.slowGate().promise);
          }),
        ),
      variant: "main",
      who: () => principal,
    };
  });
};

function cluster() {
  const log: string[] = [];
  const principals: unknown[] = [];
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  const workers = new Map<string, { host: Host; link: WatchedLink }>();
  const state = {
    browser: browserOn(server),
    log,
    principals,
    raw: rawOn(server),
    resolveGate: undefined as Promise<void> | undefined,
    server,
    slowGate: latch(),
    workers,
  };
  server.route("session:", {
    authorize: () => true,
    principal: (name) => ({ host: name }),
    resolve: (name) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const services = yield* Effect.context<never>();
          yield* Effect.promise(() => Promise.resolve(state.resolveGate));
          const existing = workers.get(name);
          if (existing !== undefined) return existing.link;
          const [down, up] = memoryLinkPair();
          const link = new WatchedLink(down);
          const worker = createHost({
            name,
            onError: () => {},
            self: { kind: "host" },
            upstream: { link: up, principal: { kind: "server" } },
          });
          serveReviewCounter(worker, { log, principals, services, slowGate: () => state.slowGate });
          workers.set(name, { host: worker, link });
          return link;
        }),
      ),
  });
  return state;
}

const internals = (host: Host) =>
  host as unknown as {
    connections: Set<{
      role: string;
      peer: { kind: string; name?: string };
      relayedRefs: Map<number, unknown>;
      relayedSubs: Map<number, unknown>;
      relayedCalls: Map<number, unknown>;
    }>;
    reloading: boolean;
  };

const linksReview = {
  Counter,
  WatchedLink,
  cluster,
  internals,
  until,
};

export default linksReview;
