import assert from "node:assert/strict";

import { type Context, Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import requests from "./fixtures/requests.ts";
import timing from "./fixtures/timing.ts";

const { createHost, hostNamed, local, memoryLinkPair, method, opaque, remote } = chord;

const { until } = requests;
const { tick } = timing;

const case7AClusterReloadReportsWhat = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const Greeter = remote("t.greeter", {
    host: hostNamed("session:S1"),
    input: Type.Object({}),
    variants: { main: { methods: { greet: method(Type.String(), Type.String()) } } },
    version: 1,
  });
  const greeter = (text: string): chordTypes.Facet => ({
    name: "greeter",
    setup: (api) =>
      api.serve(Greeter, () => ({
        greet: (name: string) => `${text} ${name}`,
        variant: "main",
      })),
  });
  const modules = new Map([["greeter", greeter("v1")]]);
  const loader: chordTypes.FacetLoader = (names) =>
    Effect.runPromiseWith(services)(
      Effect.sync(() => names.map((name) => modules.get(String(name))!)),
    );
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: "session:S1", principal: { worker: "S1" } });
  const worker = createHost({
    loader,
    name: "session:S1",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  worker.install(greeter("v1"));
  yield* tick;
  const ref = server.hold(Greeter, {});
  assert.equal(yield* Effect.promise(() => ref.greet("a")), "v1 a");
  modules.set("greeter", greeter("v2"));
  const report = yield* Effect.promise(() =>
    server.reload([], { remote: { "session:": ["greeter"] } }),
  );
  assert.deepEqual(report.changed, []);
  const child = report.children?.["session:S1"];
  assert.deepEqual(child?.changed, ["t.greeter"]);
  assert.equal(child?.prepared.length, 1);
  assert.equal(child?.codeVersion, report.codeVersion);
});

const case8AHeldRemoteReferenceKeeps = Effect.gen(function* () {
  const Counter = remote("t.count8", {
    host: hostNamed("server"),
    input: Type.Object({}),
    variants: {
      main: { methods: { set: method(Type.Number()) }, state: { n: Type.Number() } },
    },
    version: 1,
  });
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  server.serve(Counter, (_input, _principal, self) => {
    const n = self.state("n", Type.Number(), 0);
    return {
      n,
      set: (value, ctx) => {
        n.replace(ctx, value);
      },
      variant: "main",
    };
  });
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { guest: "g" } });
  const browser = createHost({
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  const counter = browser.hold(Counter, {});
  yield* Effect.promise(() => counter.ready);
  assert.equal(counter.n.value, 0);
  const stop = counter.n.subscribe(() => {});
  yield* Effect.promise(() => counter.set(1));
  yield* until(() => counter.n.value === 1);
  stop();
  yield* Effect.promise(() => counter.set(2));
  yield* until(() => counter.n.value === 2);
  const seen: unknown[] = [];
  const again = counter.n.subscribe((value) => seen.push(value));
  assert.deepEqual(seen, [2]);
  again();
});

const case9ReferencesReportStatusChangesLive = Effect.gen(function* () {
  const Thing = remote("t.thing9", {
    host: hostNamed("server"),
    input: Type.Object({}),
    variants: { main: {} },
    version: 1,
  });
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  server.serve(Thing, () => ({ variant: "main" }));
  const localThing = server.hold(Thing, {}, { principal: { user: "u" } });
  const localStatus: unknown[] = [];
  localThing.onStatus((status, error) =>
    localStatus.push(status === "gone" ? [status, (error as { code: string }).code] : status),
  );
  yield* Effect.promise(() => localThing.ready);
  yield* tick;
  yield* Effect.promise(() => server.invalidatePrincipal({ user: "u" }));
  yield* tick;
  assert.deepEqual(localStatus, ["live", ["gone", "gone"]]);

  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { guest: "g" } });
  const browser = createHost({
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  const remoteThing = browser.hold(Thing, {});
  const remoteStatus: string[] = [];
  remoteThing.onStatus((status) => remoteStatus.push(status));
  yield* Effect.promise(() => remoteThing.ready);
  up.close();
  yield* until(() => remoteStatus.length === 2);
  const [down2, up2] = memoryLinkPair();
  server.accept(down2, { principal: { guest: "g" } });
  browser.connect(up2, { principal: { kind: "server" } });
  yield* until(() => remoteStatus.length === 3);
  remoteThing.release();
  yield* tick;
  assert.deepEqual(remoteStatus, ["live", "loading", "live", "released"]);
});

const Remote = remote("t.remote10", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: { main: { methods: { note: method(Type.String()) } } },
  version: 1,
});

const Proc = local("t.proc", {
  input: Type.Object({}),
  members: { tracker: opaque<Set<string>>("t.tracker@1") },
  version: 1,
});

const Chat = local("t.chat10", { input: Type.Object({}), version: 1 });

const serveClosingChat = (
  worker: chordTypes.Host,
  log: string[],
  services: Context.Context<never>,
): void => {
  worker.serve(Chat, (_input, _principal, self) => {
    const proc = self.get(Proc, {});
    const upstream = self.get(Remote, {});
    self.resource("session", {
      close: () =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            proc.tracker?.delete("chat");
            log.push(
              `chat closed, proc ${proc.status}, tracker ${proc.tracker === undefined ? "gone" : "ok"}`,
            );
            yield* Effect.promise(() => upstream.note("bye"));
          }),
        ),
      open: () => proc.tracker?.add("chat"),
      version: 1,
    });
    return {};
  });
};

const case10HostCloseDisposesHoldersBefore = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const log: string[] = [];
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  server.serve(Remote, () => ({
    note: (text) => {
      log.push(`server: ${text}`);
    },
    variant: "main",
  }));
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: "w", principal: { worker: "w" } });
  const worker = createHost({
    name: "w",
    onError: (error) => log.push(`error: ${String(error)}`),
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  worker.serve(
    Proc,
    (_input, _principal, self) => {
      const tracker = self.resource("tracker", {
        close: () => void log.push("proc closed"),
        open: () => new Set<string>(),
        version: 1,
      });
      return { tracker: self.expose(tracker) };
    },
    { lifetime: "host" },
  );
  yield* Effect.sleep(5);
  serveClosingChat(worker, log, services);
  yield* Effect.promise(() => worker.hold(Chat, {}).ready);
  yield* Effect.promise(() => worker.close());
  assert.deepEqual(log, ["chat closed, proc live, tracker ok", "server: bye", "proc closed"]);
});

describe("application requests", () => {
  it("#7 a cluster reload reports what each child prepared", () =>
    Effect.runPromise(case7AClusterReloadReportsWhat));

  it("#8 a held remote reference keeps its state without listeners; a later subscriber sees the current value", () =>
    Effect.runPromise(case8AHeldRemoteReferenceKeeps));

  it("#9 references report status changes: live, loading while a link reconnects, gone, released", () =>
    Effect.runPromise(case9ReferencesReportStatusChangesLive));

  it("#10 host close disposes holders before what they hold, and before closing links", () =>
    Effect.runPromise(case10HostCloseDisposesHoldersBefore));
});
