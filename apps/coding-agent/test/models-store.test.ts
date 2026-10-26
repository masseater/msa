import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import lockfile from "proper-lockfile";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import FileModelsStore from "../src/core/file-models-store.ts";
import lockAttempts from "./lock-attempts.ts";

const { freezeLockRetries, observeLockAttempts } = lockAttempts;

const {
  abortController,
  awaited,
  changeMode,
  currentTimeMillis,
  deferredPromise,
  fileMode,
  fromJsonText,
  joinPath,
  makeDirectory,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  tempRoot,
  toJsonText,
  writeTextFile,
} = testing;

const sharedTempDir = joinPath(
  tempRoot(),
  `msa-models-store-shared-${currentTimeMillis()}-${randomSuffixSync()}`,
);
const sharedModelsPath = joinPath(sharedTempDir, "models-store.json");

beforeAll(() => runTest(makeDirectory(sharedTempDir)));

afterAll(() => runTest(removePath(sharedTempDir)));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function model(provider: string, id: string): aiTypes.Model<"openai-completions"> {
  return {
    api: "openai-completions" as const,
    baseUrl: "https://example.test/v1",
    contextWindow: 1000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 100,
    name: id,
    provider,
    reasoning: false,
  };
}

const persistsProviderCatalogsWithoutReplacingUnrelatedProviders = () =>
  runTest(
    Effect.gen(function* () {
      const store = new FileModelsStore(sharedModelsPath);

      yield* awaited(store.write("one", { checkedAt: 100, models: [model("one", "m1")] }));
      yield* awaited(store.write("two", { checkedAt: 200, models: [model("two", "m2")] }));

      const reloaded = new FileModelsStore(sharedModelsPath);
      expect((yield* awaited(reloaded.read("one")))?.models.map((entry) => entry.id)).toEqual([
        "m1",
      ]);
      expect((yield* awaited(reloaded.read("one")))?.checkedAt).toBe(100);
      expect((yield* awaited(reloaded.read("two")))?.models.map((entry) => entry.id)).toEqual([
        "m2",
      ]);

      yield* awaited(reloaded.delete("one"));
      expect(yield* awaited(reloaded.read("one"))).toBeUndefined();
      expect((yield* awaited(reloaded.read("two")))?.models.map((entry) => entry.id)).toEqual([
        "m2",
      ]);
    }),
  );

const preservesTheModeOfAnExistingModels = () =>
  runTest(
    Effect.gen(function* () {
      const managedModelsPath = joinPath(sharedTempDir, "managed-mode.json");
      yield* writeTextFile(managedModelsPath, "{}");
      yield* changeMode(managedModelsPath, 0o660);
      const store = new FileModelsStore(managedModelsPath);

      yield* awaited(store.write("one", { checkedAt: 100, models: [model("one", "m1")] }));

      expect((yield* fileMode(managedModelsPath)) & 0o777).toBe(0o660);
    }),
  );

const coalescesFileReloadsAcrossConcurrentReadersAnd = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(
        sharedModelsPath,
        yield* toJsonText({
          one: { models: [model("one", "old")] },
          two: { models: [model("two", "m2")] },
        }),
      );
      const first = new FileModelsStore(sharedModelsPath);
      const second = new FileModelsStore(sharedModelsPath);
      const lockSpy = vi.spyOn(lockfile, "lock");

      const [one, two, missing] = yield* awaited(
        Promise.all([
          first.read("one", { signal: abortController().signal }),
          second.read("two", { signal: abortController().signal }),
          first.read("missing", { signal: abortController().signal }),
        ]),
      );
      expect(one?.models.map((entry) => entry.id)).toEqual(["old"]);
      expect(two?.models.map((entry) => entry.id)).toEqual(["m2"]);
      expect(missing).toBeUndefined();
      expect(lockSpy).toHaveBeenCalledTimes(1);

      yield* awaited(
        expect(second.read("one")).resolves.toMatchObject({ models: [{ id: "old" }] }),
      );
      expect(lockSpy).toHaveBeenCalledTimes(1);

      const otherPath = joinPath(sharedTempDir, "other-models-store.json");
      yield* writeTextFile(otherPath, "{}");
      const other = new FileModelsStore(otherPath);
      yield* awaited(expect(other.read("one")).resolves.toBeUndefined());
      yield* awaited(expect(other.read("one")).resolves.toBeUndefined());
      const third = new FileModelsStore(sharedModelsPath);
      yield* writeTextFile(
        sharedModelsPath,
        yield* toJsonText({ one: { models: [model("one", "newest-model")] } }),
      );
      const [firstReload, thirdReload] = yield* awaited(
        Promise.all([first.read("one"), third.read("one")]),
      );
      expect(firstReload).toMatchObject({ models: [{ id: "newest-model" }] });
      expect(thirdReload).toMatchObject({ models: [{ id: "newest-model" }] });
      expect(lockSpy).toHaveBeenCalledTimes(3);
    }),
  );

const keepsACoalescedReloadAliveWhileAnother = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      yield* writeTextFile(
        sharedModelsPath,
        yield* toJsonText({ one: { models: [model("one", "stored")] } }),
      );
      const store = new FileModelsStore(sharedModelsPath);
      const lockGranted = deferredPromise<void>();
      const grantLock = lockGranted.resolve;
      const release = vi.fn(() => effectRunPromise(Effect.sync(() => {})));
      const lockSpy = vi.spyOn(lockfile, "lock").mockImplementation(() =>
        effectRunPromise(
          Effect.gen(function* () {
            yield* awaited(lockGranted.promise);
            return yield* awaited(release);
          }),
        ),
      );
      const firstController = abortController();
      const secondController = abortController();
      const first = store.read("one", { signal: firstController.signal });
      const second = store.read("one", { signal: secondController.signal });

      firstController.abort();
      yield* awaited(expect(first).rejects.toMatchObject({ name: "AbortError" }));
      grantLock?.();
      yield* awaited(expect(second).resolves.toMatchObject({ models: [{ id: "stored" }] }));
      expect(lockSpy).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    }),
  );

const cancelsACatalogWriteWaitingForA = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeTextFile(
        sharedModelsPath,
        yield* toJsonText({ one: { models: [model("one", "existing")] } }),
      );
      const store = new FileModelsStore(sharedModelsPath);
      freezeLockRetries();
      const release = yield* awaited(lockfile.lock(sharedModelsPath, { realpath: false }));
      const { refused, spy: lockSpy } = observeLockAttempts();
      const controller = abortController();
      const pending = store.write(
        "two",
        { models: [model("two", "cancelled")] },
        { signal: controller.signal },
      );

      yield* awaited(refused);
      controller.abort();
      yield* awaited(expect(pending).rejects.toMatchObject({ name: "AbortError" }));
      yield* awaited(release());
      expect(vi.getTimerCount()).toBe(0);
      expect(lockSpy).toHaveBeenCalledTimes(1);

      const stored = (yield* fromJsonText(yield* readTextFile(sharedModelsPath))) as Record<
        string,
        unknown
      >;
      expect(stored["one"]).toBeDefined();
      expect(stored["two"]).toBeUndefined();
    }),
  );

describe("FileModelsStore", () => {
  it(
    "persists provider catalogs without replacing unrelated providers",
    persistsProviderCatalogsWithoutReplacingUnrelatedProviders,
  );

  it.skipIf(process.platform === "win32")(
    "preserves the mode of an existing models file",
    preservesTheModeOfAnExistingModels,
  );

  it(
    "coalesces file reloads across concurrent readers and interleaved storage instances",
    coalescesFileReloadsAcrossConcurrentReadersAnd,
  );

  it(
    "keeps a coalesced reload alive while another reader is still waiting",
    keepsACoalescedReloadAliveWhileAnother,
  );

  it(
    "cancels a catalog write waiting for a held file lock without writing later",
    cancelsACatalogWriteWaitingForA,
  );
});
