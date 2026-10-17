import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import { createHost, forbidden, isChordError, local } from "../src/index.ts";

const unexpectedError = (error: unknown) => assert.fail(String(error));
const Eager = local("ready.eager", { version: 1, input: Type.Object({}) });
const Lazy = local("ready.lazy", { version: 1, input: Type.Object({}) });

const loadInstallsEveryFacetBeforeAwaiting = Effect.gen(function* () {
  const host = createHost({ self: { kind: "host" }, onError: unexpectedError });
  yield* Effect.gen(function* () {
    yield* Effect.promise(() =>
      host.load([
        {
          name: "consumer",
          setup: ({ serve }) =>
            serve(
              Eager,
              (_input, _principal, self) => {
                self.get(Lazy, {});
                return {};
              },
              { lifetime: "host" },
            ),
        },
        { name: "provider", setup: ({ serve }) => serve(Lazy, () => ({})) },
      ]),
    );
    assert.equal(host.hold(Eager, {}).status, "live");
  }).pipe(Effect.ensuring(Effect.promise(() => host.close())));
});

const missingEagerDependenciesRejectLoadInstead = Effect.gen(function* () {
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  yield* Effect.promise(() =>
    assert.rejects(
      host.load([
        {
          name: "missing",
          setup: ({ serve }) =>
            serve(
              Eager,
              (_i, _p, self) => {
                self.get(Lazy, {});
                return {};
              },
              { lifetime: "host" },
            ),
        },
      ]),
      (error) => isChordError(error, "unavailable") && error.reason === "unknown_type",
    ),
  ).pipe(Effect.ensuring(Effect.promise(() => host.close())));
});

const readyIncludesDirectHostServesBut = Effect.gen(function* () {
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  const First = local("ready.first", { version: 1, input: Type.Object({}) });
  let created = 0;
  yield* Effect.gen(function* () {
    host.serve(
      First,
      () => {
        created++;
        return {};
      },
      { lifetime: "host" },
    );
    const first = host.ready();
    host.serve(
      Eager,
      () => {
        throw forbidden("later");
      },
      { lifetime: "host" },
    );
    yield* Effect.promise(() => first);
    assert.equal(created, 1);
    yield* Effect.promise(() => assert.rejects(host.ready(), /later/u));
  }).pipe(Effect.ensuring(Effect.promise(() => host.close())));
});

describe("host: eager readiness", () => {
  it("load installs every facet before awaiting eager consumers", () =>
    Effect.runPromise(loadInstallsEveryFacetBeforeAwaiting));

  it("missing eager dependencies reject load instead of only reaching onError", () =>
    Effect.runPromise(missingEagerDependenciesRejectLoadInstead));

  it("ready includes direct host serves, but not later serves", () =>
    Effect.runPromise(readyIncludesDirectHostServesBut));
});
