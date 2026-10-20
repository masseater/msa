import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import {
  type Ctx,
  type Host,
  type Self,
  createHost,
  hostFamily,
  hostNamed,
  memoryLinkPair,
  method,
  remote,
} from "../../src/index.ts";
import type linkTypes from "./link.types.ts";

const counterVariants = {
  main: {
    methods: {
      add: method(Type.Number(), Type.Number()),
      who: method(undefined, Type.Unknown()),
    },
    state: { count: Type.Object({ n: Type.Number() }) },
  },
};

const Counter = remote("t.counter", {
  host: hostNamed("server"),
  input: Type.Object({ name: Type.String() }),
  variants: counterVariants,
  version: 1,
});

const SessionCounter = remote("t.session-counter", {
  host: hostFamily("session:", "session"),
  input: Type.Object({ name: Type.String(), session: Type.String() }),
  variants: counterVariants,
  version: 1,
});

function serveCounterImpl(host: Host, principals: unknown[] = []): void {
  const counter = (principal: unknown, self: Self) => {
    principals.push(principal);
    const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
    return {
      add: (delta: number, ctx: Ctx) => {
        count.change(ctx, (draft) => {
          draft.n += delta;
        });
        return count.value.n;
      },
      count,
      variant: "main" as const,
      who: () => principal,
    };
  };
  if (host.name === "server")
    host.serve(Counter, (_input, principal, self) => counter(principal, self));
  else host.serve(SessionCounter, (_input, principal, self) => counter(principal, self));
}

function serverWithWorker(workerName = "session:S1") {
  const errors: unknown[] = [];
  const server = createHost({
    name: "server",
    onError: (error) => errors.push(error),
    self: { kind: "host" },
  });
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: workerName, principal: { worker: workerName } });
  const worker = createHost({
    name: workerName,
    onError: (error) => errors.push(error),
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  return { down, errors, server, up, worker };
}

const browserOf =
  (
    server: Host,
    options: { pingInterval?: number; pingTimeout?: number },
  ): linkTypes.Cluster["browser"] =>
  (principal, browserOptions = {}) => {
    const [down, up] = memoryLinkPair();
    server.accept(down, {
      principal,
      ...(browserOptions.restamp === undefined ? {} : { restamp: browserOptions.restamp }),
      ...options,
    });
    const host = createHost({
      kind: "client",
      name: "browser",
      onError: () => {},
      self: { kind: "host" },
      upstream: { link: up, principal: { kind: "server" }, ...options },
    });
    const ref = { host, reconnect: () => {}, up };
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
      variant: "main",
      who: () => principal,
    };
  });
};

function cluster(options: { pingInterval?: number; pingTimeout?: number } = {}): linkTypes.Cluster {
  const log: string[] = [];
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  const workers = new Map<string, Host>();
  const state: linkTypes.Cluster = {
    allow: () => true,
    browser: browserOf(server, options),
    log,
    server,
    workers,
  };
  server.route("session:", {
    authorize: (principal, host) => state.allow(principal, host),
    principal: (name) => ({ host: name }),
    resolve: (name) =>
      Effect.runPromise(
        Effect.sync(() => {
          const [down, up] = memoryLinkPair();
          const worker = createHost({
            name,
            onError: () => {},
            self: { kind: "host" },
            upstream: { link: up, principal: { kind: "server" }, ...options },
          });
          serveSessionCounter(worker, log);
          workers.set(name, worker);
          return down;
        }),
      ),
  });
  return state;
}

const Big = remote("t.big", {
  host: hostNamed("session:S1"),
  input: Type.Object({}),
  variants: {
    main: {
      methods: { echo: method(Type.Array(Type.String()), Type.Array(Type.String())) },
      state: { notes: Type.Array(Type.String()) },
    },
  },
  version: 1,
});

const large = (tag: string) =>
  Array.from({ length: 40 }, (_, i) => `${tag}${i}:${"x".repeat(4000)}`);

const serveCounter: {
  (principals?: unknown[]): (host: Host) => void;
  (host: Host, principals?: unknown[]): void;
} = dual(
  (args: IArguments) => typeof (args[0] as { serve?: unknown } | undefined)?.serve === "function",
  serveCounterImpl,
);

const linkModule = {
  Big,
  Counter,
  SessionCounter,
  cluster,
  counterVariants,
  large,
  serveCounter,
  serverWithWorker,
};

export default linkModule;
