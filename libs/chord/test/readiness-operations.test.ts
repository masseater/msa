import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import timing from "./fixtures/timing.ts";

const { createHost, defineRegistry, forbidden, hostNamed, local, memoryLinkPair, remote } = chord;

const { latch, tick } = timing;

type Operation = "install" | "load";
type Failure = "factory" | "dependency" | "resource";

const unexpectedError = (error: unknown) => assert.fail(String(error));
const Eager = local("ready.eager", { input: Type.Object({}), version: 1 });
const Lazy = local("ready.lazy", { input: Type.Object({}), version: 1 });
const Status = remote("ready.status", {
  host: hostNamed("server"),
  input: Type.Object({}),
  variants: { default: {} },
  version: 1,
});

const apply = (
  host: chordTypes.Host,
  operation: Operation,
  facet: chordTypes.Facet,
): Promise<void> => (operation === "install" ? host.install(facet) : host.load([facet]));

interface ActivationProbe {
  readonly facet: chordTypes.Facet;
  readonly entries: chordTypes.Registry<string>;
  readonly open: () => void;
  readonly lazyRuns: () => number;
}

const activationProbe = (): ActivationProbe => {
  const entries = defineRegistry<string>("ready.entries");
  let opened = () => {};
  let lazyRuns = 0;
  const facet = {
    name: "ready",
    setup({ serve }: chordTypes.FacetApi) {
      serve(
        Eager,
        (_input, _principal, self) => {
          self.resource("r", {
            open: () => {
              const gate = latch();
              opened = gate.open;
              return gate.promise;
            },
            version: 1,
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
  return { entries, facet, lazyRuns: () => lazyRuns, open: () => opened() };
};

const awaitsActivationAndRegistration = (operation: Operation) =>
  Effect.gen(function* () {
    const host = createHost({ onError: unexpectedError, self: { kind: "host" } });
    const probe = activationProbe();
    let settled = false;
    yield* Effect.gen(function* () {
      const loading = apply(host, operation, probe.facet);
      void loading.then(() => {
        settled = true;
        return undefined;
      });
      yield* tick;
      assert.equal(settled, false);
      assert.equal(host.registry(probe.entries).get("eager"), undefined);
      probe.open();
      yield* Effect.promise(() => loading);
      assert.equal(host.registry(probe.entries).get("eager"), "live");
      assert.equal(probe.lazyRuns(), 0);
    }).pipe(Effect.ensuring(Effect.promise(() => host.close())));
  });

const failingFacet = (failure: Failure, cause: unknown): chordTypes.Facet => ({
  name: "bad",
  setup({ serve }: chordTypes.FacetApi) {
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
            open: () => {
              throw cause;
            },
            version: 1,
          });
        return {};
      },
      { lifetime: "host" },
    );
  },
});

const rejectsEagerFailure = (operation: Operation, failure: Failure) =>
  Effect.gen(function* () {
    const errors: unknown[] = [];
    const host = createHost({
      onError: (error) => errors.push(error),
      self: { kind: "host" },
    });
    const cause = forbidden(`${failure} failed`);
    const facet = failingFacet(failure, cause);
    yield* Effect.gen(function* () {
      yield* Effect.promise(() =>
        assert.rejects(apply(host, operation, facet), (error) => error === cause),
      );
      yield* Effect.promise(() => assert.rejects(host.ready(), (error) => error === cause));
      assert.deepEqual(errors, [cause]);
    }).pipe(Effect.ensuring(Effect.promise(() => host.close())));
  });

interface WorkerProbe {
  readonly facet: chordTypes.Facet;
  readonly bootstrap: () => boolean;
  readonly reported: () => boolean;
}

const workerProbe = (): WorkerProbe => {
  let bootstrap = false;
  let reported = false;
  const facet = {
    name: "worker",
    setup({ serve }: chordTypes.FacetApi) {
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
            deps: [status],
            open: () => {
              reported = true;
            },
            version: 1,
          });
          return {};
        },
        { lifetime: "host" },
      );
    },
  };
  return { bootstrap: () => bootstrap, facet, reported: () => reported };
};

const defersReadinessUntilAdmitted = (operation: Operation) =>
  Effect.gen(function* () {
    const server = createHost({ name: "server", onError: unexpectedError, self: { kind: "host" } });
    const [parent, upstream] = memoryLinkPair();
    const worker = createHost({
      name: "worker",
      onError: unexpectedError,
      self: { kind: "host" },
      upstream: { link: upstream, principal: { kind: "server" } },
    });
    server.serve(Status, () => ({ variant: "default" }));
    const probe = workerProbe();
    yield* Effect.gen(function* () {
      yield* Effect.promise(() =>
        operation === "install"
          ? worker.install(probe.facet, { awaitHostObjects: false })
          : worker.load([probe.facet], { awaitHostObjects: false }),
      );
      yield* Effect.promise(() => worker.hold(Lazy, {}).ready);
      assert.equal(probe.bootstrap(), true);
      let settled = false;
      const ready = worker.ready().then(() => {
        settled = true;
        return undefined;
      });
      yield* tick;
      assert.equal(settled, false);
      assert.equal(probe.reported(), false);
      server.accept(parent, { kind: "host", name: "worker", principal: { host: "worker" } });
      yield* Effect.promise(() => ready);
      assert.equal(probe.reported(), true);
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* Effect.promise(() => worker.close());
          yield* Effect.promise(() => server.close());
        }),
      ),
    );
  });

describe("host: eager readiness per operation", () => {
  for (const operation of ["install", "load"] as const) {
    it(`${operation} awaits resource activation and registration, leaving lazy objects lazy`, () =>
      Effect.runPromise(awaitsActivationAndRegistration(operation)));

    for (const failure of ["factory", "dependency", "resource"] as const) {
      it(`${operation} rejects eager ${failure} failure with the activation error`, () =>
        Effect.runPromise(rejectsEagerFailure(operation, failure)));
    }

    it(
      `${operation} can defer eager readiness until the parent admits the worker`,
      { timeout: 2000 },
      () => Effect.runPromise(defersReadinessUntilAdmitted(operation)),
    );
  }
});
