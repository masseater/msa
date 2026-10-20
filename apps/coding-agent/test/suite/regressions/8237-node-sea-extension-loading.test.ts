import { Effect } from "effect";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => {
  const builtin = Reflect.get(process, "getBuiltinModule") as (id: string) => unknown;
  const builtinSpy = vi
    .spyOn(process, "getBuiltinModule")
    .mockImplementation(((id: string) =>
      id === "node:sea" ? { isSea: () => true } : builtin.call(process, id)) as never);
  return {
    builtinSpy,
    createJiti: vi.fn((_id: unknown, _options: unknown) => ({
      import: vi.fn(() => Promise.resolve(() => {})),
    })),
    jitiModuleLoads: 0,
    virtualModulesLoads: 0,
  };
});

vi.mock("jiti/static", () => {
  state.jitiModuleLoads++;
  return { createJiti: state.createJiti };
});

vi.mock("../../../src/core/extensions/virtual-modules.ts", () => {
  state.virtualModulesLoads++;
  return {
    default: {
      VIRTUAL_MODULES: {
        "@msa/coding-agent": {},
        typebox: {},
      },
    },
  };
});

import loader from "../../../src/core/extensions/loader.ts";

const { loadExtensions } = loader;

interface JitiOptionsProbe {
  alias?: unknown;
  tryNative?: boolean;
  virtualModules?: Record<string, unknown>;
}

afterAll(() => {
  state.builtinSpy.mockRestore();
});

const loadsJitiAndBundledVirtualModules = Effect.gen(function* () {
  expect(state.jitiModuleLoads).toBe(0);
  expect(state.virtualModulesLoads).toBe(0);

  const result = yield* Effect.promise(() => loadExtensions(["/extension.ts"], "/"));

  expect(result.errors).toEqual([]);
  expect(state.jitiModuleLoads).toBe(1);
  expect(state.virtualModulesLoads).toBe(1);
  expect(result.extensions).toHaveLength(1);
  expect(state.createJiti).toHaveBeenCalledOnce();

  const [call] = state.createJiti.mock.calls;
  if (call === undefined) throw new Error("expected createJiti to be called");
  const options = call[1] as JitiOptionsProbe;

  expect(options.tryNative).toBe(false);
  expect(options.alias).toBeUndefined();
  expect(options.virtualModules?.["typebox"]).toBeDefined();
  expect(options.virtualModules?.["@msa/coding-agent"]).toBeDefined();
});

const loadsJitiAndBundledVirtualModulesOnly = () =>
  Effect.runPromise(loadsJitiAndBundledVirtualModules);

describe("Node SEA extension loading", () => {
  it(
    "loads jiti and bundled virtual modules only when importing an extension",
    loadsJitiAndBundledVirtualModulesOnly,
  );
});
