import { type Context, Effect } from "effect";
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
  PROTOCOL_VERSION,
  remote,
} from "../../src/index.ts";
import { type Latch, latch, pollUntil } from "./timing.ts";

export const until = pollUntil(100, Effect.sleep(2));

export class WatchedLink implements Link {
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

export const Counter = remote("t.counter", {
  version: 1,
  input: Type.Object({ name: Type.String() }),
  host: hostNamed("session:S1"),
  variants: {
    main: {
      state: { count: Type.Object({ n: Type.Number() }) },
      methods: {
        add: method(Type.Number(), Type.Number()),
        who: method(undefined, Type.Unknown()),
        slow: method(),
      },
    },
  },
});

const browserOn =
  (server: Host) => (principal: unknown, restamp?: (p: unknown) => unknown | undefined) => {
    const [down, up] = memoryLinkPair();
    server.accept(down, { principal, ...(restamp === undefined ? {} : { restamp }) });
    return {
      host: createHost({
        self: { kind: "host" },
        name: "browser",
        kind: "client",
        upstream: { link: up, principal: { kind: "server" } },
        onError: () => {},
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
    t: "hello",
    protocol: PROTOCOL_VERSION,
    name: "raw",
    kind: "client",
    codeVersion: 0,
  });
  return { raw, frames };
};

interface CounterEnv {
  readonly principals: unknown[];
  readonly log: string[];
  readonly slowGate: () => Latch;
  readonly services: Context.Context<never>;
}

const serveReviewCounter = (worker: Host, env: CounterEnv): void => {
  const { principals, log, services } = env;
  worker.serve(Counter, (input, principal, self) => {
    principals.push(principal);
    self.resource("probe", {
      version: 1,
      open: () => void log.push(`open ${input.name}`),
      close: () => void log.push(`close ${input.name}`),
    });
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
      who: () => principal,
      slow: (ctx: Ctx) =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            ctx.signal.addEventListener("abort", () => log.push("slow aborted"));
            yield* Effect.promise(() => env.slowGate().promise);
          }),
        ),
    };
  });
};

export function cluster() {
  const log: string[] = [];
  const principals: unknown[] = [];
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  const workers = new Map<string, { host: Host; link: WatchedLink }>();
  const state = {
    server,
    log,
    principals,
    workers,
    resolveGate: undefined as Promise<void> | undefined,
    slowGate: latch(),
    browser: browserOn(server),
    raw: rawOn(server),
  };
  server.route("session:", {
    principal: (name) => ({ host: name }),
    authorize: () => true,
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
            self: { kind: "host" },
            name,
            upstream: { link: up, principal: { kind: "server" } },
            onError: () => {},
          });
          serveReviewCounter(worker, { principals, log, slowGate: () => state.slowGate, services });
          workers.set(name, { host: worker, link });
          return link;
        }),
      ),
  });
  return state;
}

export const internals = (host: Host) =>
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
