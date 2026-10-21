import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expectTypeOf, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import bindings from "./fixtures/bindings.ts";
import counting from "./fixtures/counting.ts";

const { createHost, hostNamed, isChordError, memoryLinkPair, method, remote } = chord;

const { Notes, setup, until } = bindings;
const { stateFrames } = counting;

const readingBeforeTheFirstHydrationThrows = Effect.gen(function* () {
  const { server, browser } = setup();
  const notes = browser.hold(Notes, {});
  assert.throws(
    () => notes.notes.value,
    (error) => isChordError(error, "not_ready"),
  );
  yield* Effect.promise(() => notes.ready);
  assert.deepEqual(notes.notes.value, []);
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => server.close());
});

const Matrix = remote("t.e8-matrix", {
  host: hostNamed("server"),
  input: Type.Object({ variant: Type.String() }),
  variants: {
    bare: { methods: { ping: method(undefined, Type.String()) } },
    broken: { state: { n: Type.Number() } },
    values: {
      state: { empty: Type.Array(Type.String()), maybe: Type.Unknown(), none: Type.Null() },
    },
  },
  version: 1,
});

function serveMatrix(host: chordTypes.Host): void {
  host.serve(Matrix, ({ variant }, _principal, self) => {
    if (variant === "bare") return { ping: () => "pong", variant: "bare" };
    if (variant === "broken") {
      const source = self.state("source", Type.String(), "not a number");
      return { n: self.derive([source], (text) => text as unknown as number), variant: "broken" };
    }
    const none = self.state("none", Type.Null(), null);
    const empty = self.state("empty", Type.Array(Type.String()), []);
    return {
      empty,
      maybe: self.derive([none], () => undefined as unknown),
      none,
      variant: "values",
    };
  });
}

const nullEmptyAndUndefinedValuesHydrate = Effect.gen(function* () {
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  serveMatrix(server);
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { user: "u" } });
  const browser = createHost({
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  const values = yield* Effect.promise(() => browser.get(Matrix, { variant: "values" }));
  assert.ok(values.variant === "values");
  assert.equal(values.none.value, null);
  assert.deepEqual(values.empty.value, []);
  assert.equal(values.maybe.value, undefined);
  const bare = yield* Effect.promise(() => browser.get(Matrix, { variant: "bare" }));
  assert.ok(bare.variant === "bare");
  assert.equal(yield* Effect.promise(() => bare.ping()), "pong");
  expectTypeOf(bare).not.toHaveProperty("none");
  assert.throws(
    () => Reflect.get(Reflect.get(bare, "none"), "value"),
    (error) => isChordError(error, "not_in_variant"),
  );
  const broken = browser.hold(Matrix, { variant: "broken" });
  yield* Effect.promise(() =>
    assert.rejects(broken.ready, (error) => isChordError(error, "invalid")),
  );
  assert.equal(broken.status, "gone");
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => server.close());
});

describe("hydration over a link", () => {
  it("null, empty and undefined values hydrate; a state-free variant is ready; a failed snapshot rejects", () =>
    Effect.runPromise(nullEmptyAndUndefinedValuesHydrate));

  it("reading before the first hydration throws not_ready", () =>
    Effect.runPromise(readingBeforeTheFirstHydrationThrows));
});

const transferNoStateAloneAFull = Effect.gen(function* () {
  const { server, browser, link } = setup();
  const caller = browser.hold(Notes, {}, { state: false });
  yield* Effect.promise(() => caller.ready);
  yield* Effect.promise(() => caller.add("x"));
  const hold = link.sent.find((frame) => frame.t === "hold");
  assert.ok(hold?.t === "hold" && hold.state === false);
  assert.deepEqual(stateFrames(link.received), []);
  assert.throws(
    () => caller.notes.value,
    (error) => isChordError(error, "not_ready"),
  );

  const viewer = browser.hold(Notes, {});
  yield* Effect.promise(() => viewer.ready);
  assert.deepEqual(viewer.notes.value, ["x"]);
  assert.equal(link.count("sent", "sub"), 1);
  assert.equal(link.count("sent", "hold"), 1, "the same hold");
  viewer.release();
  yield* until(() => link.count("sent", "unsub") === 1);
  const after = stateFrames(link.received).length;
  yield* Effect.promise(() => caller.add("y"));
  yield* Effect.sleep(5);
  assert.equal(
    stateFrames(link.received).length,
    after,
    "no state once only method-only references remain",
  );
  yield* Effect.promise(() => browser.close());
  yield* Effect.promise(() => server.close());
});

describe("method-only references (state: false)", () => {
  it("transfer no state alone; a full reference joining starts it once; its release stops it", () =>
    Effect.runPromise(transferNoStateAloneAFull));
});
