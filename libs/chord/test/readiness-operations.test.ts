import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { describe, it } from "vite-plus/test";

import {
  createHost,
  defineRegistry,
  type Facet,
  type FacetApi,
  forbidden,
  type Host,
  hostNamed,
  local,
  memoryLinkPair,
  type Registry,
  remote,
} from "../src/index.ts";
import { latch, tick } from "./fixtures/timing.ts";

type Operation = "install" | "load";
type Failure = "factory" | "dependency" | "resource";

const unexpectedError = (error: unknown) => assert.fail(String(error));
const Eager = local("ready.eager", { version: 1, input: Type.Object({}) });
const Lazy = local("ready.lazy", { version: 1, input: Type.Object({}) });
const Status = remote("ready.status", {
  version: 1,
  input: Type.Object({}),
  host: hostNamed("server"),
  variants: { default: {} },
});

const apply = (host: Host, operation: Operation, facet: Facet): Promise<void> =>
  operation === "install" ? host.install(facet) : host.load([facet]);

interface ActivationProbe {
  readonly facet: Facet;
  readonly entries: Registry<string>;
  readonly open: () => void;
  readonly lazyRuns: () => number;
}

const activationProbe = (): ActivationProbe => {
  const entries = defineRegistry<string>("ready.entries");
  let opened = () => {};
  let lazyRuns = 0;
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
  return { facet, entries, open: () => opened(), lazyRuns: () => lazyRuns };
};

const awaitsActivationAndRegistration = (operation: Operation) =>
  Effect.gen(function* () {
    const host = createHost({ self: { kind: "host" }, onError: unexpectedError });
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

const failingFacet = (failure: Failure, cause: unknown): Facet => ({
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
});

const rejectsEagerFailure = (operation: Operation, failure: Failure) =>
  Effect.gen(function* () {
    const errors: unknown[] = [];
    const host = createHost({
      self: { kind: "host" },
      onError: (error) => errors.push(error),
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
  readonly facet: Facet;
  readonly bootstrap: () => boolean;
  readonly reported: () => boolean;
}

const workerProbe = (): WorkerProbe => {
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
  return { facet, bootstrap: () => bootstrap, reported: () => reported };
};

const defersReadinessUntilAdmitted = (operation: Operation) =>
  Effect.gen(function* () {
    const server = createHost({ self: { kind: "host" }, name: "server", onError: unexpectedError });
    const [parent, upstream] = memoryLinkPair();
    const worker = createHost({
      self: { kind: "host" },
      name: "worker",
      upstream: { link: upstream, principal: { kind: "server" } },
      onError: unexpectedError,
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
