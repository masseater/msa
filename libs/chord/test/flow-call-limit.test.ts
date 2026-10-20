import assert from "node:assert/strict";

import { Effect } from "effect";
import { describe, it } from "vite-plus/test";

import { createHost, isChordError, memoryLinkPair } from "../src/index.ts";
import flow from "./fixtures/flow.ts";

const { Counter, releaseWaiting, resetWaiting, serveCounter } = flow;

const answersCallsBeyondMaxcallsAtOnce = Effect.gen(function* () {
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  serveCounter(server);
  const [down, up] = memoryLinkPair();
  server.accept(down, { maxCalls: 2, principal: { user: "u" } });
  const host = createHost({
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link: up, principal: { kind: "server" } },
  });
  const counter = host.hold(Counter, {});
  yield* Effect.promise(() => counter.ready);
  resetWaiting();
  const first = counter.wait();
  const second = counter.wait();
  yield* Effect.promise(() =>
    assert.rejects(
      counter.add(1),
      (error) => isChordError(error, "unavailable") && error.reason === "too_many_calls",
    ),
  );
  releaseWaiting();
  yield* Effect.promise(() => Promise.all([first, second]));
  assert.equal(yield* Effect.promise(() => counter.add(1)), 1);
  yield* Effect.promise(() => host.close());
  yield* Effect.promise(() => server.close());
});

describe("link call limit", () => {
  it("answers calls beyond maxCalls at once with too_many_calls and keeps the link", () =>
    Effect.runPromise(answersCallsBeyondMaxcallsAtOnce));
});
