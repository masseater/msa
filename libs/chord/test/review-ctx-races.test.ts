import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import counting from "./fixtures/counting.ts";
import review from "./fixtures/review.ts";
import timing from "./fixtures/timing.ts";

const { createHost, hostNamed, isChordError, local, memoryLinkPair, method, remote } = chord;

const { CountingLink } = counting;
const { abortController } = review;
const { latch, ticks } = timing;

const aRemoteReferenceRefusesAForeign = Effect.gen(function* () {
  const RemoteTarget = remote("t.remote-target", {
    host: hostNamed("server"),
    input: Type.Object({}),
    variants: { main: { methods: { hit: method() }, state: {} } },
    version: 1,
  });
  let hits = 0;
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  server.serve(RemoteTarget, () => ({
    hit: () => {
      hits++;
    },
    variant: "main",
  }));
  const [down, up] = memoryLinkPair();
  server.accept(down, { kind: "host", name: "worker", principal: { worker: true } });
  const link = new CountingLink(up);
  const worker = createHost({ name: "worker", onError: () => {}, self: { kind: "host" } });
  worker.connect(link, { principal: { kind: "server" } });
  const other = createHost({ name: "other", onError: () => {}, self: { kind: "host" } });
  const target = worker.hold(RemoteTarget, {});
  yield* Effect.promise(() => target.ready);
  const foreign = yield* Effect.promise(() =>
    other.root((ctx) => target.hit(ctx).catch((error: unknown) => error)),
  );
  assert.ok(isChordError(foreign, "invalid") && foreign.reason === "foreign_ctx", String(foreign));
  const forged = {
    codeVersion: 1,
    rootId: "forged",
    signal: abortController().signal,
  } as unknown as chordTypes.Ctx;
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
  input: Type.Object({}),
  members: { hit: method() },
  version: 1,
});

const anAbortedTaskCtxCannotStart = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const Runner = local("t.runner", { input: Type.Object({}), version: 1 });
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
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const other = createHost({ onError: () => {}, self: { kind: "host" } });
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
