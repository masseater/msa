import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expectTypeOf, it } from "vite-plus/test";

import {
  createHost,
  type Host,
  hostNamed,
  isChordError,
  memoryLinkPair,
  method,
  remote,
} from "../src/index.ts";
import { Notes, setup, until } from "./fixtures/bindings.ts";
import { stateFrames } from "./fixtures/counting.ts";

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

describe("hydration over a link", () => {
  const Matrix = remote("t.e8-matrix", {
    version: 1,
    input: Type.Object({ variant: Type.String() }),
    host: hostNamed("server"),
    variants: {
      values: {
        state: { none: Type.Null(), empty: Type.Array(Type.String()), maybe: Type.Unknown() },
      },
      bare: { methods: { ping: method(undefined, Type.String()) } },
      broken: { state: { n: Type.Number() } },
    },
  });

  function serveMatrix(host: Host): void {
    host.serve(Matrix, ({ variant }, _principal, self) => {
      if (variant === "bare") return { variant: "bare", ping: () => "pong" };
      if (variant === "broken") {
        const source = self.state("source", Type.String(), "not a number");
        return { variant: "broken", n: self.derive([source], (text) => text as unknown as number) };
      }
      const none = self.state("none", Type.Null(), null);
      const empty = self.state("empty", Type.Array(Type.String()), []);
      return {
        variant: "values",
        none,
        empty,
        maybe: self.derive([none], () => undefined as unknown),
      };
    });
  }

  it("null, empty and undefined values hydrate; a state-free variant is ready; a failed snapshot rejects", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
        serveMatrix(server);
        const [down, up] = memoryLinkPair();
        server.accept(down, { principal: { user: "u" } });
        const browser = createHost({
          self: { kind: "host" },
          name: "browser",
          kind: "client",
          upstream: { link: up, principal: { kind: "server" } },
          onError: () => {},
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
      }),
    ));

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
