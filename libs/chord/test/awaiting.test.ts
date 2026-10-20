import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import counting from "./fixtures/counting.ts";
import timing from "./fixtures/timing.ts";

const { createHost, hostNamed, isChordError, memoryLinkPair, remote } = chord;

const { CountingLink } = counting;
const { latch, pollUntil } = timing;

const until = (check: () => boolean, attempts = 200) => pollUntil(check, attempts, Effect.sleep(2));

const Slow = remote("t.e8-slow", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: { main: { state: { n: Type.Number() } } },
  version: 1,
});

function setup(readyTimeout?: number) {
  const gate = latch();
  const open = gate.open;
  const server = createHost({ name: "server", onError: () => {}, self: { kind: "host" } });
  server.serve(Slow, (_input, _principal, self) => {
    self.resource("gate", { open: () => gate.promise, version: 1 });
    return { n: self.state("n", Type.Number(), 1), variant: "main" };
  });
  const [down, up] = memoryLinkPair();
  server.accept(down, { principal: { user: "u" } });
  const link = new CountingLink(up);
  const browser: chordTypes.Host = createHost({
    kind: "client",
    name: "browser",
    onError: () => {},
    self: { kind: "host" },
    upstream: { link, principal: { kind: "server" } },
    ...(readyTimeout === undefined ? {} : { readyTimeout }),
  });
  return { browser, link, open, server };
}

const abortController = (): AbortController => new AbortController();

const anAbortedGetRejectsAndReleases = Effect.gen(function* () {
  const { server, browser, link, open } = setup();
  const abort = abortController();
  const first = browser.get(Slow, {}, { signal: abort.signal });
  const second = browser.get(Slow, {});
  yield* Effect.sleep(5);
  abort.abort();
  yield* Effect.promise(() => assert.rejects(first, (error) => isChordError(error, "aborted")));
  yield* Effect.sleep(5);
  assert.equal(link.count("sent", "release"), 0, "the other awaiting get keeps the hold");
  open();
  const ref = yield* Effect.promise(() => second);
  assert.equal(ref.n.value, 1);
  assert.equal(link.count("sent", "hold"), 1);
  ref.release();
  yield* until(() => link.count("sent", "release") === 1);
  yield* Effect.promise(() => server.close());
});

const aCtxGetStillWaitingWhen = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, browser, link, open } = setup();
  let pending: Promise<unknown> | undefined;
  yield* Effect.promise(() =>
    browser.root((ctx: chordTypes.Ctx) =>
      Effect.runPromiseWith(services)(
        Effect.sync(() => {
          pending = ctx.get(Slow, {});
          pending.catch(() => {});
        }),
      ),
    ),
  );
  yield* Effect.promise(() => assert.rejects(pending!, (error) => isChordError(error, "aborted")));
  yield* until(() => link.count("sent", "release") === 1);
  open();
  yield* Effect.promise(() => server.close());
});

const aGetTimesOutAfterReadytimeout = Effect.gen(function* () {
  const { server, browser, link } = setup(30);
  yield* Effect.promise(() =>
    assert.rejects(
      browser.get(Slow, {}),
      (error) => isChordError(error, "unavailable") && error.reason === "ready_timeout",
    ),
  );
  yield* until(() => link.count("sent", "release") === 1);
  yield* Effect.promise(() => server.close());
});

const ctxGetResolvesHydratedTheCall = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const { server, browser, link, open } = setup();
  open();
  const value = yield* Effect.promise(() =>
    browser.root((ctx: chordTypes.Ctx) =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          const slow = yield* Effect.promise(() => ctx.get(Slow, {}));
          return slow.n.value;
        }),
      ),
    ),
  );
  assert.equal(value, 1);
  yield* until(() => link.count("sent", "release") === 1);
  yield* Effect.promise(() => server.close());
});

describe("awaited gets", () => {
  it("an aborted get rejects and releases only its reference; the binding stays for the others", () =>
    Effect.runPromise(anAbortedGetRejectsAndReleases));

  it("a ctx.get still waiting when its call settles rejects aborted and releases its reference", () =>
    Effect.runPromise(aCtxGetStillWaitingWhen));

  it("a get times out after readyTimeout with ready_timeout and releases its hold", () =>
    Effect.runPromise(aGetTimesOutAfterReadytimeout));

  it("ctx.get resolves hydrated; the call's reference is released when the call ends", () =>
    Effect.runPromise(ctxGetResolvesHydratedTheCall));
});
