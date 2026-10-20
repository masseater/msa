import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";

const { createHost, hostNamed, isChordError, local, memoryLinkPair, method, remote } = chord;

const Source = remote("t.e8-source", {
  host: hostNamed("w"),
  input: Type.Object({}),
  variants: { main: { methods: { set: method(Type.String()) }, state: { v: Type.String() } } },
  version: 1,
});

const Forward = remote("t.e8-forward", {
  host: hostNamed("server"),
  input: Type.Object({ how: Type.String() }),
  variants: { main: { state: { size: Type.Number(), v: Type.String() } } },
  version: 1,
});

function serveSource(host: chordTypes.Host): void {
  host.serve(Source, (_input, _principal, self) => {
    const v = self.state("v", Type.String(), "from the worker");
    return {
      set: (text: string, ctx: chordTypes.Ctx) => {
        v.replace(ctx, text);
      },
      v,
      variant: "main",
    };
  });
}

function cluster(options: { readonly delay?: number; readonly readyTimeout?: number } = {}) {
  const server = createHost({
    name: "server",
    onError: () => {},
    self: { kind: "host" },
    ...(options.readyTimeout === undefined ? {} : { readyTimeout: options.readyTimeout }),
  });
  const [down, up] = memoryLinkPair();
  const worker = createHost({
    name: "w",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
    ...(options.readyTimeout === undefined ? {} : { readyTimeout: options.readyTimeout }),
  });
  const admit = () =>
    server.accept(down, { kind: "host", name: "w", principal: { kind: "worker" } });
  if (options.delay === undefined) admit();
  else Effect.runFork(Effect.delay(Effect.sync(admit), options.delay));
  const browser = () => {
    const [down2, up2] = memoryLinkPair();
    server.accept(down2, { principal: { user: "u" } });
    return createHost({
      kind: "client",
      name: "browser",
      onError: () => {},
      self: { kind: "host" },
      upstream: { link: up2, principal: { kind: "server" } },
    });
  };
  return { browser, server, worker };
}

const anObjectThatForwardsAndDerives = Effect.gen(function* () {
  const c = cluster();
  serveSource(c.worker);
  const held = c.server.hold(Source, {});
  c.server.serve(Forward, ({ how }, _principal, self) => {
    const source = how === "declared" ? self.get(Source, {}) : held;
    return {
      size: self.derive([source.v], (text) => text.length),
      v: source.v,
      variant: "main",
    };
  });
  const browser = c.browser();
  for (const how of ["held", "declared"]) {
    const forward = browser.hold(Forward, { how });
    yield* Effect.promise(() => forward.ready);
    assert.equal(forward.v.value, "from the worker");
    assert.equal(forward.size.value, "from the worker".length);
    const onServer = c.server.hold(Forward, { how });
    yield* Effect.promise(() => onServer.ready);
    assert.equal(onServer.v.value, "from the worker");
  }
  yield* Effect.promise(() => c.server.close());
  yield* Effect.promise(() => c.worker.close());
});

const aMemberReadInsideAFactory = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const Inner = local("t.e8-inner", {
    input: Type.Object({}),
    members: { n: Type.Number() },
    version: 1,
  });
  const Outer = local("t.e8-outer", {
    input: Type.Object({}),
    members: { m: Type.Number() },
    version: 1,
  });
  host.serve(Inner, (_input, _principal, self) => ({ n: self.state("n", Type.Number(), 7) }));
  const seen: unknown[] = [];
  host.serve(Outer, (_input, _principal, self) => {
    const inner = self.get(Inner, {});
    try {
      seen.push(inner.n.value);
    } catch (error) {
      seen.push(isChordError(error, "not_ready") ? "not_ready" : error);
    }
    return { m: self.derive([inner.n], (n) => n * 2) };
  });
  const outer = host.hold(Outer, {});
  yield* Effect.promise(() => outer.ready);
  assert.deepEqual(seen, ["not_ready"]);
  assert.equal(outer.m.value, 14);
});

const aHostObjectOfAChild = Effect.gen(function* () {
  const Settings = remote("t.e8-settings", {
    host: hostNamed("server"),
    input: Type.Object({}),
    variants: { main: { state: { theme: Type.String() } } },
    version: 1,
  });
  const Local = local("t.e8-boot", {
    input: Type.Object({}),
    members: { theme: Type.String() },
    version: 1,
  });
  const c = cluster({ delay: 20 });
  c.server.serve(Settings, (_input, _principal, self) => ({
    theme: self.state("theme", Type.String(), "dark"),
    variant: "main",
  }));
  yield* Effect.promise(() =>
    c.worker.install(
      {
        name: "boot",
        setup: (api) =>
          api.serve(
            Local,
            (_input, _principal, self) => {
              const settings = self.get(Settings, {});
              return { theme: settings.theme };
            },
            { lifetime: "host" },
          ),
      },
      { awaitHostObjects: false },
    ),
  );
  yield* Effect.promise(() => c.worker.ready());
  const boot = c.worker.hold(Local, {});
  yield* Effect.promise(() => boot.ready);
  assert.equal(boot.theme.value, "dark");
  yield* Effect.promise(() => c.server.close());
  yield* Effect.promise(() => c.worker.close());
});

const aReferenceCycleAcrossHostsFails = Effect.gen(function* () {
  const A = remote("t.e8-cycle-a", {
    host: hostNamed("server"),
    input: Type.Object({}),
    variants: { main: {} },
    version: 1,
  });
  const B = remote("t.e8-cycle-b", {
    host: hostNamed("w"),
    input: Type.Object({}),
    variants: { main: {} },
    version: 1,
  });
  const c = cluster({ readyTimeout: 50 });
  c.server.serve(A, (_input, _principal, self) => {
    self.get(B, {});
    return { variant: "main" };
  });
  c.worker.serve(B, (_input, _principal, self) => {
    self.get(A, {});
    return { variant: "main" };
  });
  const a = c.server.hold(A, {});
  yield* Effect.promise(() =>
    assert.rejects(
      a.ready,
      (error) =>
        isChordError(error, "unavailable") &&
        error.reason === "ready_timeout" &&
        /cycle/u.test(error.message),
    ),
  );
  yield* Effect.sleep(10);
  yield* Effect.promise(() => c.server.close());
  yield* Effect.promise(() => c.worker.close());
});

describe("local hydration", () => {
  it("an object that forwards and derives from a remote member goes live with its value", () =>
    Effect.runPromise(anObjectThatForwardsAndDerives));

  it("a member read inside a factory throws not_ready; it is a plain value once live", () =>
    Effect.runPromise(aMemberReadInsideAFactory));

  it("a host object of a child holding the parent's object goes live once the parent admits the child", () =>
    Effect.runPromise(aHostObjectOfAChild));

  it("a reference cycle across hosts fails at readyTimeout with a cycle hint", () =>
    Effect.runPromise(aReferenceCycleAcrossHostsFails));
});
