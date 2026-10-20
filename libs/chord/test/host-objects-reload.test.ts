import assert from "node:assert/strict";

import { Effect } from "effect";
import { Type } from "typebox";
import { onTestFinished, test } from "vite-plus/test";

import hostModule from "../src/host.ts";
import chord from "../src/index.ts";
import type chordTypes from "../src/index.types.ts";
import hostObjectsReload from "./fixtures/host-objects-reload.ts";
import timing from "./fixtures/timing.ts";

const { HostImpl } = hostModule;
const { createHost, isChordError, local, memoryLinkPair, method } = chord;

const { Read, ReadV1, ReadV2, SwitchV1, SwitchV2, SwitchV3, readerV1, readerV2, switchFacets } =
  hostObjectsReload;
const { tick } = timing;

const theHostSReferenceToA = Effect.gen(function* () {
  const errors: unknown[] = [];
  const host = new HostImpl({
    dev: true,
    onError: (error) => errors.push(error),
    self: { kind: "host" },
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
  assert.equal(object?.refs.size, 1, "Attach the replacement before releasing the only old hold");
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
});

test("the host's reference to a host object follows contract bumps at commit without reopening its object or resources; failures retain the old reference", () =>
  Effect.runPromise(theHostSReferenceToA));

const externalOldVersionConsumersStillRefuse = Effect.gen(function* () {
  const host = new HostImpl({
    onError: (error) => {
      throw error;
    },
    self: { kind: "host" },
  });
  onTestFinished(() => host.close());
  yield* Effect.promise(() => host.load([readerV1]));
  const own = host.hostObjects.get(ReadV1.name)!;
  const consumer = host.hold(ReadV1, {});
  assert.equal(yield* Effect.promise(() => consumer.read()), "one");
  yield* Effect.promise(() =>
    assert.rejects(host.reload([readerV2()]), (error) => isChordError(error, "contract_mismatch")),
  );
  assert.equal(host.hostObjects.get(ReadV1.name), own);
  assert.equal(yield* Effect.promise(() => consumer.read()), "one");
  yield* Effect.promise(() => host.reload([readerV2(true)]));
  assert.equal(host.hostObjects.get(ReadV2.name)?.contract, ReadV2);
  assert.equal(yield* Effect.promise(() => consumer.read()), "two");
  assert.equal(consumer.contract, ReadV1, "Only the bootstrap hold is retokened");
  assert.equal(yield* Effect.promise(() => host.hold(ReadV2, {}).fetch()), "two");
});

test("external old-version consumers still refuse a host object's upgrade without accepts, and keep their adapter when it is provided", () =>
  Effect.runPromise(externalOldVersionConsumersStillRefuse));

const objectOwnedOldVersionReferencesStill = Effect.gen(function* () {
  const host = new HostImpl({ onError: () => {}, self: { kind: "host" } });
  onTestFinished(() => host.close());
  const Consumer = local("t.eager-consumer", {
    input: Type.Object({}),
    members: { read: method(undefined, Type.String()) },
    version: 1,
  });
  const oldConsumer: chordTypes.Facet = {
    name: "consumer",
    setup: (api) =>
      api.serve(Consumer, (_input, _principal, self) => {
        const reader = self.get(ReadV1, {});
        return { read: (ctx) => reader.read(ctx) };
      }),
  };
  const newConsumer: chordTypes.Facet = {
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
    assert.rejects(host.reload([readerV2()]), (error) => isChordError(error, "contract_mismatch")),
  );
  assert.equal(yield* Effect.promise(() => consumer.read()), "one");
  yield* Effect.promise(() => host.reload([readerV2(), newConsumer]));
  assert.equal(yield* Effect.promise(() => consumer.read()), "two");
  assert.equal(host.hostObjects.get(ReadV2.name)?.contract, ReadV2);
});

test("object-owned old-version references still block a host object's upgrade unless their consumer is replaced in the same batch", () =>
  Effect.runPromise(objectOwnedOldVersionReferencesStill));

const aForgottenContractBumpRemainsRefused = Effect.gen(function* () {
  const host = new HostImpl({ onError: () => {}, self: { kind: "host" } });
  onTestFinished(() => host.close());
  yield* Effect.promise(() => host.load([readerV1]));
  const incompatible = local(ReadV1.name, {
    input: Type.Object({}),
    members: { fetch: method(undefined, Type.String()) },
    version: 1,
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
        isChordError(error, "contract_mismatch") && /without a version bump/u.test(error.message),
    ),
  );
  assert.equal(host.hostObjects.get(ReadV1.name)?.contract, ReadV1);
});

test("a forgotten contract bump remains refused even when the only consumer is the host's own reference", () =>
  Effect.runPromise(aForgottenContractBumpRemainsRefused));

const aClusterContractUpgradeRetokensThe = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const log: string[] = [];
  const facets = switchFacets(log);
  let valid = false;
  const server = new HostImpl({ onError: () => {}, self: { kind: "host" } });
  const worker = new HostImpl({
    loader: () => Effect.runPromiseWith(services)(Effect.sync(() => [facets.v2(valid)])),
    name: "worker",
    onError: () => {},
    self: { kind: "host" },
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
    assert.rejects(server.reload([facets.v2(true)], { remote: { worker: ["switch"] } }), (error) =>
      isChordError(error, "invalid"),
    ),
  );
  assert.equal(server.hostObjects.get(SwitchV1.name), serverOwn);
  assert.equal(worker.hostObjects.get(SwitchV1.name), workerOwn);
  valid = true;
  yield* Effect.promise(() => server.reload([facets.v2(true)], { remote: { worker: ["switch"] } }));
  yield* tick;
  assert.equal(server.hostObjects.get(SwitchV2.name)?.contract, SwitchV2);
  assert.equal(worker.hostObjects.get(SwitchV2.name)?.contract, SwitchV2);
  assert.deepEqual(server.registry(Read).get("current")!(), { 1: false });
  assert.deepEqual(worker.registry(Read).get("current")!(), { 1: false });
  assert.equal(server.codeVersion, worker.codeVersion);
  assert.deepEqual(log, ["open", "open"]);
});

test("a cluster contract upgrade retokens the server's and worker's references to host objects only after unanimous preparation", () =>
  Effect.runPromise(aClusterContractUpgradeRetokensThe));

const aReloadThatChangesAType = Effect.gen(function* () {
  const host = createHost({ onError: () => {}, self: { kind: "host" } });
  const Kept = local("t.lifetime-change", { input: Type.Object({}), version: 1 });
  const log: string[] = [];
  const facet = (lifetime: "host" | "referenced"): chordTypes.Facet => ({
    name: "kept",
    setup: (api) =>
      api.serve(
        Kept,
        (_input, _principal, self) => {
          self.resource("life", {
            close: () => {
              log.push("close");
            },
            open: () => log.push(`open ${lifetime}`),
            version: 1,
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
});

test("a reload that changes a type's lifetime creates its host object, or lets it go", () =>
  Effect.runPromise(aReloadThatChangesAType));
