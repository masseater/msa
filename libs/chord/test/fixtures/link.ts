import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import {
  type Ctx,
  createHost,
  type Host,
  hostFamily,
  hostNamed,
  memoryLinkPair,
  method,
  remote,
  type Self,
} from "../../src/index.ts";

export const counterVariants = {
  main: {
    state: { count: Type.Object({ n: Type.Number() }) },
    methods: {
      add: method(Type.Number(), Type.Number()),
      who: method(undefined, Type.Unknown()),
    },
  },
};

export const Counter = remote("t.counter", {
  version: 1,
  input: Type.Object({ name: Type.String() }),
  host: hostNamed("server"),
  variants: counterVariants,
});

export const SessionCounter = remote("t.session-counter", {
  version: 1,
  input: Type.Object({ session: Type.String(), name: Type.String() }),
  host: hostFamily("session:", "session"),
  variants: counterVariants,
});

function serveCounterImpl(host: Host, principals: unknown[] = []): void {
  const counter = (principal: unknown, self: Self) => {
    principals.push(principal);
    const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
    return {
      variant: "main" as const,
      count,
      add: (delta: number, ctx: Ctx) => {
        count.change(ctx, (draft) => {
          draft.n += delta;
        });
        return count.value.n;
      },
      who: () => principal,
    };
  };
  if (host.name === "server")
    host.serve(Counter, (_input, principal, self) => counter(principal, self));
  else host.serve(SessionCounter, (_input, principal, self) => counter(principal, self));
}

export function serverWithWorker(workerName = "session:S1") {
  const errors: unknown[] = [];
  const server = createHost({
    self: { kind: "host" },
    name: "server",
    onError: (error) => errors.push(error),
  });
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { worker: workerName }, kind: "host", name: workerName });
  const worker = createHost({
    self: { kind: "host" },
    name: workerName,
    upstream: { link: up, principal: { kind: "server" } },
    onError: (error) => errors.push(error),
  });
  return { server, worker, down, up, errors };
}

export interface Cluster {
  readonly server: Host;
  readonly workers: Map<string, Host>;
  readonly log: string[];
  browser(
    principal: unknown,
    options?: { restamp?: (principal: unknown) => unknown | undefined },
  ): {
    host: Host;
    up: ReturnType<typeof memoryLinkPair>[1];
    reconnect(): void;
  };
  allow: (principal: unknown, host: string) => boolean;
}

const browserOf =
  (server: Host, options: { pingInterval?: number; pingTimeout?: number }): Cluster["browser"] =>
  (principal, browserOptions = {}) => {
    const [down, up] = memoryLinkPair();
    server.accept(down, {
      principal,
      ...(browserOptions.restamp === undefined ? {} : { restamp: browserOptions.restamp }),
      ...options,
    });
    const host = createHost({
      self: { kind: "host" },
      name: "browser",
      kind: "client",
      upstream: { link: up, principal: { kind: "server" }, ...options },
      onError: () => {},
    });
    const ref = { host, up, reconnect: () => {} };
    ref.reconnect = () => {
      const [nextDown, nextUp] = memoryLinkPair();
      server.accept(nextDown, { principal });
      ref.up = nextUp;
      host.connect(nextUp, { principal: { kind: "server" } });
    };
    return ref;
  };

const serveSessionCounter = (worker: Host, log: string[]): void => {
  worker.serve(SessionCounter, (input, principal, self) => {
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
    };
  });
};

export function cluster(options: { pingInterval?: number; pingTimeout?: number } = {}): Cluster {
  const log: string[] = [];
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  const workers = new Map<string, Host>();
  const state: Cluster = {
    server,
    workers,
    log,
    allow: () => true,
    browser: browserOf(server, options),
  };
  server.route("session:", {
    principal: (name) => ({ host: name }),
    authorize: (principal, host) => state.allow(principal, host),
    resolve: (name) =>
      Effect.runPromise(
        Effect.sync(() => {
          const [down, up] = memoryLinkPair();
          const worker = createHost({
            self: { kind: "host" },
            name,
            upstream: { link: up, principal: { kind: "server" }, ...options },
            onError: () => {},
          });
          serveSessionCounter(worker, log);
          workers.set(name, worker);
          return down;
        }),
      ),
  });
  return state;
}

export const Big = remote("t.big", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("session:S1"),
  variants: {
    main: {
      state: { notes: Type.Array(Type.String()) },
      methods: { echo: method(Type.Array(Type.String()), Type.Array(Type.String())) },
    },
  },
});

export const large = (tag: string) =>
  Array.from({ length: 40 }, (_, i) => `${tag}${i}:${"x".repeat(4000)}`);

export const serveCounter: {
  (principals?: unknown[]): (host: Host) => void;
  (host: Host, principals?: unknown[]): void;
} = dual(
  (args: IArguments) => typeof (args[0] as { serve?: unknown } | undefined)?.serve === "function",
  serveCounterImpl,
);
