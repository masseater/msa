import assert from "node:assert/strict";

import { Effect } from "effect";
import { describe, it } from "vite-plus/test";

import { createHost, isChordError, memoryLinkPair } from "../src/index.ts";
import { Counter, releaseWaiting, resetWaiting, serveCounter } from "./fixtures/flow.ts";

const answersCallsBeyondMaxcallsAtOnce = Effect.gen(function* () {
  const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
  serveCounter(server);
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { user: "u" }, maxCalls: 2 });
  const host = createHost({
    self: { kind: "host" },
    name: "browser",
    kind: "client",
    upstream: { link: up, principal: { kind: "server" } },
    onError: () => {},
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
