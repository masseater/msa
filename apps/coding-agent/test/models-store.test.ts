import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import type { Model } from "@msa/ai";
import {
  abortController,
  awaited,
  currentTimeMillis,
  deferredPromise,
  fromJsonText,
  joinPath,
  randomSuffixSync,
  readTextFile,
  runTest,
  toJsonText,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import lockfile from "proper-lockfile";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { FileModelsStore } from "../src/core/models-store.ts";

const sharedTempDir = joinPath(
  tmpdir(),
  `msa-models-store-shared-${currentTimeMillis()}-${randomSuffixSync()}`,
);
const sharedModelsPath = joinPath(sharedTempDir, "models-store.json");

beforeAll(() =>
  runTest(
    Effect.sync(() => {
      mkdirSync(sharedTempDir, { recursive: true });
    }),
  ),
);

afterAll(() =>
  runTest(
    Effect.sync(() => {
      if (existsSync(sharedTempDir)) rmSync(sharedTempDir, { recursive: true });
    }),
  ),
);

afterEach(() => {
  vi.restoreAllMocks();
});

function model(provider: string, id: string): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions" as const,
    provider,
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

describe("FileModelsStore", () => {
  it("persists provider catalogs without replacing unrelated providers", () =>
    runTest(
      Effect.gen(function* () {
        const store = new FileModelsStore(sharedModelsPath);

        yield* awaited(store.write("one", { models: [model("one", "m1")], checkedAt: 100 }));
        yield* awaited(store.write("two", { models: [model("two", "m2")], checkedAt: 200 }));

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
    ));

  it.skipIf(process.platform === "win32")("preserves the mode of an existing models file", () =>
    runTest(
      Effect.gen(function* () {
        const managedModelsPath = joinPath(sharedTempDir, "managed-mode.json");
        writeFileSync(managedModelsPath, "{}");
        chmodSync(managedModelsPath, 0o660);
        const store = new FileModelsStore(managedModelsPath);

        yield* awaited(store.write("one", { models: [model("one", "m1")], checkedAt: 100 }));

        expect(statSync(managedModelsPath).mode & 0o777).toBe(0o660);
      }),
    ),
  );

  it("coalesces file reloads across concurrent readers and interleaved storage instances", () =>
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
    ));

  it("keeps a coalesced reload alive while another reader is still waiting", () =>
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
    ));

  it("cancels a catalog write waiting for a held file lock without writing later", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeTextFile(
          sharedModelsPath,
          yield* toJsonText({ one: { models: [model("one", "existing")] } }),
        );
        const store = new FileModelsStore(sharedModelsPath);
        const release = yield* awaited(lockfile.lock(sharedModelsPath, { realpath: false }));
        const controller = abortController();
        const pending = store.write(
          "two",
          { models: [model("two", "cancelled")] },
          { signal: controller.signal },
        );

        yield* Effect.sleep(10);
        controller.abort();
        yield* awaited(expect(pending).rejects.toMatchObject({ name: "AbortError" }));
        yield* awaited(release());
        yield* Effect.sleep(150);

        const stored = (yield* fromJsonText(yield* readTextFile(sharedModelsPath))) as Record<
          string,
          unknown
        >;
        expect(stored["one"]).toBeDefined();
        expect(stored["two"]).toBeUndefined();
      }),
    ));
});
