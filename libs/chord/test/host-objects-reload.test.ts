import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { onTestFinished, test } from "vite-plus/test";

import { HostImpl } from "../src/host.ts";
import {
  createHost,
  defineRegistry,
  type Facet,
  isChordError,
  local,
  memoryLinkPair,
  method,
  type Self,
} from "../src/index.ts";
import { tick } from "./fixtures/timing.ts";

const input = Type.Object({});
const flags = Type.Record(Type.String(), Type.Boolean());
const SwitchV1 = local("t.eager-switch", {
  version: 1,
  input,
  members: {
    enabled: Type.Boolean(),
    set: method(Type.Boolean()),
  },
});
const SwitchV2 = local("t.eager-switch", {
  version: 2,
  input,
  members: {
    enabled: flags,
    set: method(Type.Object({ conversation: Type.Number(), enabled: Type.Boolean() })),
  },
});
const SwitchV3 = local("t.eager-switch", {
  version: 3,
  input,
  members: {
    enabled: flags,
    update: method(Type.Object({ conversation: Type.Number(), enabled: Type.Boolean() })),
  },
});
const Read = defineRegistry<() => unknown>("t.eager-switch-read");

function switchFacets(log: string[]) {
  const declareResource = (self: Self) =>
    self.resource("watch", {
      version: 1,
      open: () => {
        log.push("open");
        return null;
      },
      close: () => {
        log.push("close");
      },
    });
  const v1: Facet = {
    name: "switch",
    setup: (api) =>
      api.serve(
        SwitchV1,
        (_input, _principal, self) => {
          declareResource(self);
          const enabledState = self.state("enabled", Type.Boolean(), false);
          self.register(Read, { current: () => enabledState.value });
          return {
            enabled: enabledState,
            set: (enabled, ctx) => {
              enabledState.replace(ctx, enabled);
            },
          };
        },
        { lifetime: "host" },
      ),
  };
  const v2 = (valid: boolean): Facet => ({
    name: "switch",
    setup: (api) =>
      api.serve(
        SwitchV2,
        (_input, _principal, self) => {
          declareResource(self);
          const enabledState = self.state(
            "enabled",
            flags,
            {},
            {
              version: 2,
              migrate: (old, from) => {
                assert.equal(from, 1);
                return valid ? { 1: old as boolean } : ("invalid migration" as never);
              },
            },
          );
          self.register(Read, { current: () => enabledState.value });
          return {
            enabled: enabledState,
            set: ({ conversation, enabled }, ctx) => {
              enabledState.change(ctx, (draft) => {
                draft[conversation] = enabled;
              });
            },
          };
        },
        { lifetime: "host" },
      ),
  });
  const v3: Facet = {
    name: "switch",
    setup: (api) =>
      api.serve(
        SwitchV3,
        (_input, _principal, self) => {
          declareResource(self);
          const enabledState = self.state("enabled", flags, {}, { version: 2 });
          self.register(Read, { current: () => enabledState.value });
          return {
            enabled: enabledState,
            update: ({ conversation, enabled }, ctx) => {
              enabledState.change(ctx, (draft) => {
                draft[conversation] = enabled;
              });
            },
          };
        },
        { lifetime: "host" },
      ),
  };
  return { v1, v2, v3 };
}

test("the host's reference to a host object follows contract bumps at commit without reopening its object or resources; failures retain the old reference", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const errors: unknown[] = [];
      const host = new HostImpl({
        self: { kind: "host" },
        dev: true,
        onError: (error) => errors.push(error),
      });
      onTestFinished(() => host.close());
      const log: string[] = [];
      const facets = switchFacets(log);
      yield* Effect.promise(() => host.load([facets.v1]));
      const initial = host.hostObjects.get(SwitchV1.name)!;
      const object = initial.object;
      const original = host.hold(SwitchV1, {});
      yield* Effect.promise(() => original.set(true));
      original.release();
      const codeVersion = host.codeVersion;
      yield* Effect.promise(() =>
        assert.rejects(host.reload([facets.v2(false)]), (error) => isChordError(error, "invalid")),
      );
      assert.equal(host.codeVersion, codeVersion);
      assert.equal(host.hostObjects.get(SwitchV1.name), initial);
      assert.equal(initial.status, "live");
      assert.equal(host.registry(Read).get("current")!(), true);
      const report = yield* Effect.promise(() => host.reload([facets.v2(true)]));
      assert.equal(report.gated.length, 1);
      const updated = host.hostObjects.get(SwitchV2.name)!;
      assert.equal(updated.contract, SwitchV2);
      assert.equal(updated.object, object);
      assert.equal(initial.status, "released");
      assert.equal(
        object?.refs.size,
        1,
        "Attach the replacement before releasing the only old hold",
      );
      assert.deepEqual(host.registry(Read).get("current")!(), { 1: true });
      const modern = host.hold(SwitchV2, {});
      yield* Effect.promise(() => modern.set({ conversation: 2, enabled: true }));
      modern.release();
      assert.deepEqual((yield* Effect.promise(() => host.reload([facets.v3]))).gated, []);
      assert.equal(host.hostObjects.get(SwitchV3.name)?.contract, SwitchV3);
      assert.equal(host.hostObjects.get(SwitchV3.name)?.object, object);
      assert.equal(updated.status, "released");
      assert.deepEqual(host.registry(Read).get("current")!(), { 1: true, 2: true });
      yield* Effect.promise(() => host.ready());
      assert.deepEqual(log, ["open"]);
      assert.deepEqual(errors, []);
      yield* Effect.promise(() => host.close());
      assert.deepEqual(log, ["open", "close"]);
    }),
  ));

const ReadV1 = local("t.eager-read", {
  version: 1,
  input: Type.Object({}),
  members: { read: method(undefined, Type.String()) },
});
const ReadV2 = local("t.eager-read", {
  version: 2,
  input: Type.Object({}),
  members: { fetch: method(undefined, Type.String()) },
});
const readerV1: Facet = {
  name: "read",
  setup: (api) => api.serve(ReadV1, () => ({ read: () => "one" }), { lifetime: "host" }),
};
const readerV2 = (adapt = false): Facet => ({
  name: "read",
  setup: (api) =>
    api.serve(ReadV2, () => ({ fetch: () => "two" }), {
      lifetime: "host",
      ...(adapt
        ? { accepts: { 1: (current: Record<string, unknown>) => ({ read: current["fetch"] }) } }
        : {}),
    }),
});

test("external old-version consumers still refuse a host object's upgrade without accepts, and keep their adapter when it is provided", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const host = new HostImpl({
        self: { kind: "host" },
        onError: (error) => {
          throw error;
        },
      });
      onTestFinished(() => host.close());
      yield* Effect.promise(() => host.load([readerV1]));
      const own = host.hostObjects.get(ReadV1.name)!;
      const consumer = host.hold(ReadV1, {});
      assert.equal(yield* Effect.promise(() => consumer.read()), "one");
      yield* Effect.promise(() =>
        assert.rejects(host.reload([readerV2()]), (error) =>
          isChordError(error, "contract_mismatch"),
        ),
      );
      assert.equal(host.hostObjects.get(ReadV1.name), own);
      assert.equal(yield* Effect.promise(() => consumer.read()), "one");
      yield* Effect.promise(() => host.reload([readerV2(true)]));
      assert.equal(host.hostObjects.get(ReadV2.name)?.contract, ReadV2);
      assert.equal(yield* Effect.promise(() => consumer.read()), "two");
      assert.equal(consumer.contract, ReadV1, "Only the bootstrap hold is retokened");
      assert.equal(yield* Effect.promise(() => host.hold(ReadV2, {}).fetch()), "two");
    }),
  ));

test("object-owned old-version references still block a host object's upgrade unless their consumer is replaced in the same batch", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const host = new HostImpl({ self: { kind: "host" }, onError: () => {} });
      onTestFinished(() => host.close());
      const Consumer = local("t.eager-consumer", {
        version: 1,
        input: Type.Object({}),
        members: { read: method(undefined, Type.String()) },
      });
      const oldConsumer: Facet = {
        name: "consumer",
        setup: (api) =>
          api.serve(Consumer, (_input, _principal, self) => {
            const reader = self.get(ReadV1, {});
            return { read: (ctx) => reader.read(ctx) };
          }),
      };
      const newConsumer: Facet = {
        name: "consumer",
        setup: (api) =>
          api.serve(Consumer, (_input, _principal, self) => {
            const reader = self.get(ReadV2, {});
            return { read: (ctx) => reader.fetch(ctx) };
          }),
      };
      yield* Effect.promise(() => host.load([readerV1, oldConsumer]));
      const consumer = host.hold(Consumer, {});
      assert.equal(yield* Effect.promise(() => consumer.read()), "one");
      yield* Effect.promise(() =>
        assert.rejects(host.reload([readerV2()]), (error) =>
          isChordError(error, "contract_mismatch"),
        ),
      );
      assert.equal(yield* Effect.promise(() => consumer.read()), "one");
      yield* Effect.promise(() => host.reload([readerV2(), newConsumer]));
      assert.equal(yield* Effect.promise(() => consumer.read()), "two");
      assert.equal(host.hostObjects.get(ReadV2.name)?.contract, ReadV2);
    }),
  ));

test("a forgotten contract bump remains refused even when the only consumer is the host's own reference", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const host = new HostImpl({ self: { kind: "host" }, onError: () => {} });
      onTestFinished(() => host.close());
      yield* Effect.promise(() => host.load([readerV1]));
      const incompatible = local(ReadV1.name, {
        version: 1,
        input: Type.Object({}),
        members: { fetch: method(undefined, Type.String()) },
      });
      yield* Effect.promise(() =>
        assert.rejects(
          host.reload([
            {
              name: "read",
              setup: (api) =>
                api.serve(incompatible, () => ({ fetch: () => "bad" }), { lifetime: "host" }),
            },
          ]),
          (error) =>
            isChordError(error, "contract_mismatch") &&
            /without a version bump/u.test(error.message),
        ),
      );
      assert.equal(host.hostObjects.get(ReadV1.name)?.contract, ReadV1);
    }),
  ));

test("a cluster contract upgrade retokens the server's and worker's references to host objects only after unanimous preparation", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const services = yield* Effect.context<never>();
      const log: string[] = [];
      const facets = switchFacets(log);
      let valid = false;
      const server = new HostImpl({ self: { kind: "host" }, onError: () => {} });
      const worker = new HostImpl({
        self: { kind: "host" },
        name: "worker",
        onError: () => {},
        loader: () => Effect.runPromiseWith(services)(Effect.sync(() => [facets.v2(valid)])),
      });
      onTestFinished(() =>
        Effect.runPromiseWith(services)(
          Effect.gen(function* () {
            yield* Effect.promise(() => worker.close());
            yield* Effect.promise(() => server.close());
          }),
        ),
      );
      yield* Effect.promise(() => server.load([facets.v1]));
      yield* Effect.promise(() => worker.load([facets.v1]));
      const [down, up] = memoryLinkPair();
      server.accept(down, { kind: "host", name: "worker", principal: { worker: true } });
      worker.connect(up, { principal: { kind: "server" } });
      yield* tick;
      const serverOwn = server.hostObjects.get(SwitchV1.name);
      const workerOwn = worker.hostObjects.get(SwitchV1.name);
      yield* Effect.promise(() =>
        assert.rejects(
          server.reload([facets.v2(true)], { remote: { worker: ["switch"] } }),
          (error) => isChordError(error, "invalid"),
        ),
      );
      assert.equal(server.hostObjects.get(SwitchV1.name), serverOwn);
      assert.equal(worker.hostObjects.get(SwitchV1.name), workerOwn);
      valid = true;
      yield* Effect.promise(() =>
        server.reload([facets.v2(true)], { remote: { worker: ["switch"] } }),
      );
      yield* tick;
      assert.equal(server.hostObjects.get(SwitchV2.name)?.contract, SwitchV2);
      assert.equal(worker.hostObjects.get(SwitchV2.name)?.contract, SwitchV2);
      assert.deepEqual(server.registry(Read).get("current")!(), { 1: false });
      assert.deepEqual(worker.registry(Read).get("current")!(), { 1: false });
      assert.equal(server.codeVersion, worker.codeVersion);
      assert.deepEqual(log, ["open", "open"]);
    }),
  ));

test("a reload that changes a type's lifetime creates its host object, or lets it go", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const host = createHost({ self: { kind: "host" }, onError: () => {} });
      const Kept = local("t.lifetime-change", { version: 1, input: Type.Object({}) });
      const log: string[] = [];
      const facet = (lifetime: "host" | "referenced"): Facet => ({
        name: "kept",
        setup: (api) =>
          api.serve(
            Kept,
            (_input, _principal, self) => {
              self.resource("life", {
                version: 1,
                open: () => log.push(`open ${lifetime}`),
                close: () => {
                  log.push("close");
                },
              });
              return {};
            },
            { lifetime },
          ),
      });
      yield* Effect.gen(function* () {
        yield* Effect.promise(() => host.install(facet("referenced")));
        assert.deepEqual(log, [], "a referenced object waits for its first reference");
        yield* Effect.promise(() => host.reload([facet("host")]));
        yield* Effect.promise(() => host.ready());
        assert.deepEqual(log, ["open host"], "created by the reload that made it a host object");
        yield* Effect.promise(() => host.reload([facet("referenced")]));
        for (let i = 0; i < 50 && log.length < 2; i++) yield* Effect.sleep(5);
        assert.deepEqual(log, ["open host", "close"], "nobody else references it: disposed");
      }).pipe(Effect.ensuring(Effect.promise(() => host.close())));
    }),
  ));
