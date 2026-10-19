import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  jitiModuleLoads: 0,
  jitiStaticModuleLoads: 0,
  virtualModulesLoads: 0,
  createJiti: vi.fn((_id: unknown, _options: unknown) => ({
    import: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

vi.mock("jiti", () => {
  state.jitiModuleLoads++;
  return { createJiti: state.createJiti };
});

vi.mock("jiti/static", () => {
  state.jitiStaticModuleLoads++;
  return { createJiti: state.createJiti };
});

vi.mock("../../../src/core/extensions/virtual-modules.ts", () => {
  state.virtualModulesLoads++;
  return { VIRTUAL_MODULES: {} };
});

import { loadExtensions } from "../../../src/core/extensions/loader.ts";

interface JitiOptionsProbe {
  alias?: unknown;
  tryNative?: boolean;
  tsconfigPaths?: boolean;
  virtualModules?: Record<string, unknown>;
}

const defersOrdinaryJitiAndItsVirtual = Effect.gen(function* () {
  expect(state.jitiModuleLoads).toBe(0);
  expect(state.jitiStaticModuleLoads).toBe(0);
  expect(state.virtualModulesLoads).toBe(0);

  const result = yield* Effect.promise(() => loadExtensions(["/extension.ts"], "/"));

  expect(result.errors).toEqual([]);
  expect(result.extensions).toHaveLength(1);
  expect(state.jitiModuleLoads).toBe(1);
  expect(state.jitiStaticModuleLoads).toBe(0);
  expect(state.virtualModulesLoads).toBe(1);
  expect(state.createJiti).toHaveBeenCalledOnce();

  const [call] = state.createJiti.mock.calls;
  if (call === undefined) throw new Error("expected createJiti to be called");
  const options = call[1] as JitiOptionsProbe;
  expect(options.tryNative).toBeUndefined();
  expect(options.tsconfigPaths).toBe(true);
  expect(options.alias).toBeUndefined();
  expect(options.virtualModules).toBeDefined();
});

describe("extension loader lazy imports", () => {
  it("defers ordinary jiti and its virtual modules until importing an extension", () =>
    Effect.runPromise(defersOrdinaryJitiAndItsVirtual));
});
