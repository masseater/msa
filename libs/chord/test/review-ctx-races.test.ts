import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  type Ctx,
  createHost,
  hostNamed,
  isChordError,
  local,
  memoryLinkPair,
  method,
  remote,
} from "../src/index.ts";
import { CountingLink } from "./fixtures/counting.ts";
import { abortController } from "./fixtures/review.ts";
import { latch, ticks } from "./fixtures/timing.ts";

const aRemoteReferenceRefusesAForeign = Effect.gen(function* () {
  const RemoteTarget = remote("t.remote-target", {
    version: 1,
    input: Type.Object({}),
    host: hostNamed("server"),
    variants: { main: { state: {}, methods: { hit: method() } } },
  });
  let hits = 0;
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  server.serve(RemoteTarget, () => ({
    variant: "main",
    hit: () => {
      hits++;
    },
  }));
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: "worker", principal: { worker: true } });
  const link = new CountingLink(up);
  const worker = createHost({ self: { kind: "host" }, name: "worker", onError: () => {} });
  worker.connect(link, { principal: { kind: "server" } });
  const other = createHost({ self: { kind: "host" }, name: "other", onError: () => {} });
  const target = worker.hold(RemoteTarget, {});
  yield* Effect.promise(() => target.ready);
  const foreign = yield* Effect.promise(() =>
    other.root((ctx) => target.hit(ctx).catch((error: unknown) => error)),
  );
  assert.ok(isChordError(foreign, "invalid") && foreign.reason === "foreign_ctx", String(foreign));
  const forged = {
    rootId: "forged",
    codeVersion: 1,
    signal: abortController().signal,
  } as unknown as Ctx;
  yield* Effect.promise(() =>
    assert.rejects(
      target.hit(forged),
      (error) => isChordError(error, "invalid") && error.reason === "foreign_ctx",
    ),
  );
  yield* ticks();
  assert.equal(hits, 0);
  assert.equal(link.count("sent", "call"), 0);
  yield* Effect.promise(() => worker.root((ctx) => target.hit(ctx)));
  assert.equal(hits, 1);
});

const Target = local("t.target", {
  version: 1,
  input: Type.Object({}),
  members: { hit: method() },
});

const anAbortedTaskCtxCannotStart = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  const Runner = local("t.runner", { version: 1, input: Type.Object({}) });
  let hits = 0;
  const go = latch();
  let outcome: unknown;
  host.serve(Target, () => ({
    hit: () => {
      hits++;
    },
  }));
  host.serve(Runner, (_input, _principal, self) => {
    const target = self.get(Target, {});
    self.task((ctx) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          yield* go.wait;
          outcome = yield* Effect.promise(() => target.hit(ctx).catch((error: unknown) => error));
        }),
      ),
    );
    return {};
  });
  const runner = host.hold(Runner, {});
  yield* Effect.promise(() => runner.ready);
  const target = host.hold(Target, {});
  yield* Effect.promise(() => target.ready);
  runner.release();
  yield* ticks();
  go.open();
  yield* ticks(20);
  assert.equal(hits, 0);
  assert.ok(isChordError(outcome, "aborted"));
});

const anExpiredCtxAndAForeign = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  const other = createHost({ self: { kind: "host" }, onError: () => {} });
  host.serve(Target, () => ({ hit: () => {} }));
  const target = host.hold(Target, {});
  yield* Effect.promise(() => target.ready);
  const expired = yield* Effect.promise(() => host.root((ctx) => ctx));
  yield* Effect.promise(() =>
    assert.rejects(
      target.hit(expired),
      (error) => isChordError(error, "aborted") && error.reason === "expired",
    ),
  );
  const foreign = yield* Effect.promise(() =>
    other.root((ctx) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            assert.rejects(
              target.hit(ctx),
              (error) => isChordError(error, "invalid") && error.reason === "foreign_ctx",
            ),
          );
          return true;
        }),
      ),
    ),
  );
  assert.ok(foreign);
});

describe("review: ctx races", () => {
  it("an aborted task ctx cannot start fresh calls", () =>
    Effect.runPromise(anAbortedTaskCtxCannotStart));

  it("an expired ctx and a foreign ctx are refused", () =>
    Effect.runPromise(anExpiredCtxAndAForeign));

  it("a remote reference refuses a foreign ctx and a ctx not made by Chord, without calling", () =>
    Effect.runPromise(aRemoteReferenceRefusesAForeign));
});
