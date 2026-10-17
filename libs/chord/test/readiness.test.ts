import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  createHost,
  defineRegistry,
  type FacetApi,
  forbidden,
  hostNamed,
  isChordError,
  local,
  memoryLinkPair,
  remote,
} from "../src/index.ts";
import { latch, tick } from "./fixtures/timing.ts";

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

describe("host: eager readiness", () => {
  for (const operation of ["install", "load"] as const) {
    it(`${operation} awaits resource activation and registration, leaving lazy objects lazy`, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const host = createHost({ self: { kind: "host" }, onError: unexpectedError });
          const entries = defineRegistry<string>("ready.entries");
          let opened = () => {};
          let lazyRuns = 0;
          let settled = false;
          const facet = {
            name: "ready",
            setup({ serve }: FacetApi) {
              serve(
                Eager,
                (_input, _principal, self) => {
                  self.resource("r", {
                    version: 1,
                    open: () => {
                      const gate = latch();
                      opened = gate.open;
                      return gate.promise;
                    },
                  });
                  self.register(entries, { eager: "live" });
                  return {};
                },
                { lifetime: "host" },
              );
              serve(Lazy, () => {
                lazyRuns++;
                return {};
              });
            },
          };
          yield* Effect.gen(function* () {
            const loading = operation === "install" ? host.install(facet) : host.load([facet]);
            void loading.then(() => {
              settled = true;
              return undefined;
            });
            yield* tick;
            assert.equal(settled, false);
            assert.equal(host.registry(entries).get("eager"), undefined);
            opened();
            yield* Effect.promise(() => loading);
            assert.equal(host.registry(entries).get("eager"), "live");
            assert.equal(lazyRuns, 0);
          }).pipe(Effect.ensuring(Effect.promise(() => host.close())));
        }),
      ));

    for (const failure of ["factory", "dependency", "resource"] as const) {
      it(`${operation} rejects eager ${failure} failure with the activation error`, () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const errors: unknown[] = [];
            const host = createHost({
              self: { kind: "host" },
              onError: (error) => errors.push(error),
            });
            const cause = forbidden(`${failure} failed`);
            const facet = {
              name: "bad",
              setup({ serve }: FacetApi) {
                serve(Lazy, () => {
                  throw cause;
                });
                serve(
                  Eager,
                  (_input, _principal, self) => {
                    if (failure === "factory") throw cause;
                    if (failure === "dependency") self.get(Lazy, {});
                    if (failure === "resource")
                      self.resource("r", {
                        version: 1,
                        open: () => {
                          throw cause;
                        },
                      });
                    return {};
                  },
                  { lifetime: "host" },
                );
              },
            };
            yield* Effect.gen(function* () {
              yield* Effect.promise(() =>
                assert.rejects(
                  operation === "install" ? host.install(facet) : host.load([facet]),
                  (error) => error === cause,
                ),
              );
              yield* Effect.promise(() => assert.rejects(host.ready(), (error) => error === cause));
              assert.deepEqual(errors, [cause]);
            }).pipe(Effect.ensuring(Effect.promise(() => host.close())));
          }),
        ));
    }
  }

  it("load installs every facet before awaiting eager consumers", () =>
    Effect.runPromise(loadInstallsEveryFacetBeforeAwaiting));

  it("missing eager dependencies reject load instead of only reaching onError", () =>
    Effect.runPromise(missingEagerDependenciesRejectLoadInstead));

  it("ready includes direct host serves, but not later serves", () =>
    Effect.runPromise(
      Effect.gen(function* () {
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
      }),
    ));

  for (const operation of ["install", "load"] as const) {
    it(
      `${operation} can defer eager readiness until the parent admits the worker`,
      { timeout: 2000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const server = createHost({
              self: { kind: "host" },
              name: "server",
              onError: unexpectedError,
            });
            const [parent, upstream] = memoryLinkPair();
            const worker = createHost({
              self: { kind: "host" },
              name: "worker",
              upstream: { link: upstream, principal: { kind: "server" } },
              onError: unexpectedError,
            });
            const Status = remote("ready.status", {
              version: 1,
              input: Type.Object({}),
              host: hostNamed("server"),
              variants: { default: {} },
            });
            server.serve(Status, () => ({ variant: "default" }));
            let bootstrap = false;
            let reported = false;
            const facet = {
              name: "worker",
              setup({ serve }: FacetApi) {
                serve(
                  Lazy,
                  () => {
                    bootstrap = true;
                    return {};
                  },
                  { lifetime: "host" },
                );
                serve(
                  Eager,
                  (_input, _principal, self) => {
                    const status = self.get(Status, {});
                    self.resource("r", {
                      version: 1,
                      deps: [status],
                      open: () => {
                        reported = true;
                      },
                    });
                    return {};
                  },
                  { lifetime: "host" },
                );
              },
            };
            yield* Effect.gen(function* () {
              yield* Effect.promise(() =>
                operation === "install"
                  ? worker.install(facet, { awaitHostObjects: false })
                  : worker.load([facet], { awaitHostObjects: false }),
              );
              yield* Effect.promise(() => worker.hold(Lazy, {}).ready);
              assert.equal(bootstrap, true);
              let settled = false;
              const ready = worker.ready().then(() => {
                settled = true;
                return undefined;
              });
              yield* tick;
              assert.equal(settled, false);
              assert.equal(reported, false);
              server.accept(parent, {
                kind: "host",
                name: "worker",
                principal: { host: "worker" },
              });
              yield* Effect.promise(() => ready);
              assert.equal(reported, true);
            }).pipe(
              Effect.ensuring(
                Effect.gen(function* () {
                  yield* Effect.promise(() => worker.close());
                  yield* Effect.promise(() => server.close());
                }),
              ),
            );
          }),
        ),
    );
  }
});
