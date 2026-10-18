import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  clearExtensionCache,
  loadExtensions,
  loadExtensionsCached,
} from "../../../src/core/extensions/loader.ts";
import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import { join } from "../../test-path.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

interface TestState {
  moduleLoads?: number;
  factoryRuns?: number;
}

function state(): TestState {
  const global = globalThis as typeof globalThis & { extensionFactoryCacheTestState?: TestState };
  if (global.extensionFactoryCacheTestState === undefined) {
    global.extensionFactoryCacheTestState = {};
  }
  return global.extensionFactoryCacheTestState;
}

function resetState(): void {
  delete (globalThis as typeof globalThis & { extensionFactoryCacheTestState?: TestState })
    .extensionFactoryCacheTestState;
}

function writeCountingExtension(filePath: string) {
  return runtime.runPromise(
    fs.writeFileString(
      filePath,
      `
const state = (globalThis.extensionFactoryCacheTestState ??= {});
state.moduleLoads = (state.moduleLoads ?? 0) + 1;

export default function () {
	state.factoryRuns = (state.factoryRuns ?? 0) + 1;
}
`,
    ),
  );
}

const roots: string[] = [];

function fixture(name: string) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const root = yield* fs.makeTempDirectory({ prefix: `msa-extension-cache-${name}-` });
      const cwd = join(root, "project");
      const agentDir = join(root, "agent");
      yield* fs.makeDirectory(cwd, { recursive: true });
      yield* fs.makeDirectory(agentDir, { recursive: true });
      roots.push(root);
      return { root, cwd, agentDir };
    }),
  );
}

const cachesExtensionModulesForCachedSame = Effect.gen(function* () {
  const { root, cwd } = yield* Effect.promise(() => fixture("same-cwd"));
  const extensionPath = join(root, "counting.ts");
  yield* Effect.promise(() => writeCountingExtension(extensionPath));

  const first = yield* Effect.promise(() => loadExtensionsCached([extensionPath], cwd));
  const second = yield* Effect.promise(() => loadExtensionsCached([extensionPath], cwd));

  expect(state().moduleLoads).toBe(1);
  expect(state().factoryRuns).toBe(2);
  expect(first.extensions[0]).not.toBe(second.extensions[0]);
  expect(first.runtime).not.toBe(second.runtime);
});

const doesNotCacheDirectLoadextensionsCalls = Effect.gen(function* () {
  const { root, cwd } = yield* Effect.promise(() => fixture("direct"));
  const extensionPath = join(root, "counting.ts");
  yield* Effect.promise(() => writeCountingExtension(extensionPath));

  yield* Effect.promise(() => loadExtensions([extensionPath], cwd));
  yield* Effect.promise(() => loadExtensions([extensionPath], cwd));

  expect(state().moduleLoads).toBe(2);
  expect(state().factoryRuns).toBe(2);
});

const clearsTheCacheOnResourceLoader = Effect.gen(function* () {
  const { cwd, agentDir } = yield* Effect.promise(() => fixture("reload"));
  const extensionDir = join(agentDir, "extensions");
  yield* fs.makeDirectory(extensionDir, { recursive: true });
  yield* Effect.promise(() => writeCountingExtension(join(extensionDir, "counting.ts")));
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });

  yield* Effect.promise(() => loader.reload());
  yield* Effect.promise(() => loader.reload());

  expect(state().moduleLoads).toBe(2);
  expect(state().factoryRuns).toBe(2);
});

const keepsTheCacheScopedToOne = Effect.gen(function* () {
  const { root } = yield* Effect.promise(() => fixture("cross-cwd"));
  const firstCwd = join(root, "first");
  const secondCwd = join(root, "second");
  yield* fs.makeDirectory(firstCwd, { recursive: true });
  yield* fs.makeDirectory(secondCwd, { recursive: true });
  const extensionPath = join(root, "counting.ts");
  yield* Effect.promise(() => writeCountingExtension(extensionPath));

  yield* Effect.promise(() => loadExtensionsCached([extensionPath], firstCwd));
  yield* Effect.promise(() => loadExtensionsCached([extensionPath], secondCwd));
  yield* Effect.promise(() => loadExtensionsCached([extensionPath], secondCwd));

  expect(state().moduleLoads).toBe(2);
  expect(state().factoryRuns).toBe(3);
});

describe("extension factory cache", () => {
  beforeEach(() => {
    resetState();
    clearExtensionCache();
  });
  afterEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        while (roots.length > 0) {
          const root = roots.pop();
          if (root !== undefined && root !== "" && (yield* fs.exists(root))) {
            yield* fs.remove(root, { recursive: true, force: true });
          }
        }
        resetState();
        clearExtensionCache();
      }),
    ),
  );
  it("caches extension modules for cached same-cwd loads but reruns factories", () =>
    Effect.runPromise(cachesExtensionModulesForCachedSame));
  it("does not cache direct loadExtensions calls", () =>
    Effect.runPromise(doesNotCacheDirectLoadextensionsCalls));
  it("clears the cache on resource loader reload", () =>
    Effect.runPromise(clearsTheCacheOnResourceLoader));
  it("keeps the cache scoped to one cwd", () => Effect.runPromise(keepsTheCacheScopedToOne));
});
