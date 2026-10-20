import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  type Ctx,
  createHost,
  defineRegistry,
  forbidden,
  isChordError,
  local,
  method,
} from "../src/index.ts";
import hostModule from "./fixtures/host.ts";
import timing from "./fixtures/timing.ts";

const { quiet } = hostModule;
const { tick } = timing;

const Routes = defineRegistry<string>("t.routes");

const rejectsConflictingRegistrations = Effect.gen(function* () {
  const errors: unknown[] = [];
  const host = quiet(errors);
  for (const name of ["t.conflict-a", "t.conflict-b"]) {
    host.serve(
      local(name, { input: Type.Object({}), version: 1 }),
      (_input, _principal, self) => {
        self.register(Routes, { same: name });
        return {};
      },
      { lifetime: "host" },
    );
  }
  yield* tick;
  yield* tick;
  assert.ok(errors.some((error) => /registry_conflict/u.test(String(error))));
});

describe("host: registries", () => {
  it('only objects of lifetime "host" register; tables follow registration order', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const host = quiet();
        const RoutesA = local("t.routes-a", { input: Type.Object({}), version: 1 });
        const RoutesB = local("t.routes-b", { input: Type.Object({}), version: 1 });
        host.serve(
          RoutesA,
          (_input, _principal, self) => {
            self.register(Routes, { "GET /a": "a", "GET /c": "c" });
            return {};
          },
          { lifetime: "host" },
        );
        host.serve(
          RoutesB,
          (_input, _principal, self) => {
            self.register(Routes, { "GET /b": "b" });
            return {};
          },
          { lifetime: "host" },
        );
        const tables: string[][] = [];
        host.registry(Routes).subscribe((table) => tables.push([...table.keys()]));
        yield* tick;
        yield* tick;
        assert.deepEqual([...host.registry(Routes).table().keys()], ["GET /a", "GET /c", "GET /b"]);
        assert.equal(host.registry(Routes).get("GET /b"), "b");
        assert.deepEqual(tables.at(-1), ["GET /a", "GET /c", "GET /b"]);

        const Lazy = local("t.lazy-register", { input: Type.Object({}), version: 1 });
        host.serve(Lazy, (_input, _principal, self) => {
          self.register(Routes, { x: "x" });
          return {};
        });
        yield* Effect.promise(() =>
          assert.rejects(
            host.hold(Lazy, {}).ready,
            /only objects of lifetime "host" may register/u,
          ),
        );
      }),
    ));

  it("rejects conflicting registrations", () => Effect.runPromise(rejectsConflictingRegistrations));
});

const ctxGetActsAsTheRoot = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = createHost({
    onError: () => {},
    principalKey: (principal) => JSON.stringify(principal),
    self: { kind: "host" },
  });
  const seen: unknown[] = [];
  const Who = local("t.who", {
    input: Type.Object({}),
    members: { ping: method() },
    version: 1,
  });
  const Front = local("t.front", {
    input: Type.Object({}),
    members: { relay: method() },
    version: 1,
  });
  host.serve(Who, (_input, principal) => {
    seen.push(principal);
    return { ping: () => {} };
  });
  host.serve(Front, (_input, principal) => {
    seen.push(principal);
    return {
      relay: (ctx: Ctx) =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            const peer = yield* Effect.promise(() => ctx.get(Who, {}));
            return yield* Effect.promise(() => peer.ping(ctx));
          }),
        ),
    };
  });
  yield* Effect.promise(() =>
    host.root(
      (ctx) =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            const peer = yield* Effect.promise(() => ctx.get(Front, {}));
            return yield* Effect.promise(() => peer.relay(ctx));
          }),
        ),
      {
        principal: { user: "guest" },
      },
    ),
  );
  assert.deepEqual(seen, [{ user: "guest" }, { kind: "host" }]);
});

const aChorderrorFromAFactoryKeeps = Effect.gen(function* () {
  const host = quiet();
  const Secret = local("t.secret", { input: Type.Object({}), version: 1 });
  const Page = local("t.page", { input: Type.Object({}), version: 1 });
  host.serve(Secret, () => {
    throw forbidden("not for you");
  });
  host.serve(Page, (_input, _principal, self) => {
    self.get(Secret, {});
    return {};
  });
  yield* Effect.promise(() =>
    assert.rejects(host.hold(Page, {}).ready, (error) => isChordError(error, "forbidden")),
  );
});

const Source = local("t.source", {
  input: Type.Object({}),
  members: { n: Type.Number(), set: method(Type.Number()) },
  version: 1,
});
const Mirror = local("t.mirror", {
  input: Type.Object({}),
  members: { copy: Type.Number(), doubled: Type.Number() },
  version: 1,
});

const referenceStateMembersAreSourcesFor = Effect.gen(function* () {
  const host = quiet();
  host.serve(Source, (_input, _principal, self) => {
    const n = self.state("n", Type.Number(), 1);
    return {
      n,
      set: (value: number, ctx: Ctx) => {
        n.replace(ctx, value);
      },
    };
  });
  host.serve(Mirror, (_input, _principal, self) => {
    const source = self.get(Source, {});
    const copy = self.state("copy", Type.Number(), 0);
    self.on("follow", source.n, (value, ctx) => copy.replace(ctx, value ?? 0));
    const doubled = self.derive([source.n], (n) => (n ?? 0) * 2);
    return { copy, doubled };
  });
  const mirror = host.hold(Mirror, {});
  yield* Effect.promise(() => mirror.ready);
  yield* tick;
  assert.equal(mirror.copy.value, 1);
  assert.equal(mirror.doubled.value, 2);
  yield* Effect.promise(() => host.hold(Source, {}).set(5));
  yield* tick;
  assert.equal(mirror.copy.value, 5);
  assert.equal(mirror.doubled.value, 10);
});

const callingAReferenceInsideAFactory = Effect.gen(function* () {
  const host = quiet();
  host.serve(Source, (_input, _principal, self) => ({
    n: self.state("n", Type.Number(), 0),
    set: () => {},
  }));
  const Eager = local("t.eager-call", { input: Type.Object({}), version: 1 });
  host.serve(Eager, (_input, _principal, self) => {
    const source = self.get(Source, {});
    void source.set(1);
    return {};
  });
  yield* Effect.promise(() =>
    assert.rejects(host.hold(Eager, {}).ready, (error) => isChordError(error, "not_ready")),
  );
});

describe("host: composition", () => {
  it("reference state members are sources for listeners and derivations", () =>
    Effect.runPromise(referenceStateMembersAreSourcesFor));

  it("ctx.get acts as the root principal at ingress and as the host inside objects", () =>
    Effect.runPromise(ctxGetActsAsTheRoot));

  it("calling a reference inside a factory throws not_ready", () =>
    Effect.runPromise(callingAReferenceInsideAFactory));

  it("a ChordError from a factory keeps its code through dependents", () =>
    Effect.runPromise(aChorderrorFromAFactoryKeeps));
});
