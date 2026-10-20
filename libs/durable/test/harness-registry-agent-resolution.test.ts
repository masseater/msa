import { defineExtension, hook } from "@msa/durable";
import { GenerationTask, ToolTask, createRegistry } from "@msa/durable/harness";
import { describe, expect, it } from "vite-plus/test";

import { agentHooks } from "../src/harness/agent.ts";
import harnessRegistrySupport from "./harness-registry-support.ts";
import type harnessRegistrySupportTypes from "./harness-registry-support.types.ts";

const { resolve } = harnessRegistrySupport;

describe("agent resolution", () => {
  it("collects hooks of the selected extensions in extension order and applies field defaults", () => {
    const local = createRegistry<harnessRegistrySupportTypes.AppTool>();
    const first = { beforeTool: () => undefined };
    const second = { beforeTool: () => undefined };
    const onYield = { onYield: () => undefined };
    local.install(
      defineExtension<harnessRegistrySupportTypes.AppTool>({
        hooks: [hook(ToolTask, first), hook(GenerationTask, onYield)],
        name: "a",
      }),
    );
    local.install(
      defineExtension<harnessRegistrySupportTypes.AppTool>({
        hooks: [hook(ToolTask, second)],
        name: "b",
      }),
    );
    expect(agentHooks(resolve(undefined, local.snapshot()), "msa.tool")).toEqual([first, second]);
    expect(agentHooks(resolve({ extensions: ["b", "a"] }, local.snapshot()), "msa.tool")).toEqual([
      second,
      first,
    ]);
    expect(agentHooks(resolve({ extensions: ["b"] }, local.snapshot()), "msa.generation")).toEqual(
      [],
    );

    const defaults = resolve(undefined, local.snapshot());
    expect(defaults.model).toBeUndefined();
    expect(defaults.thinkingLevel).toBe("off");
    expect(defaults.cwd).toBeUndefined();
    expect(
      resolve(
        { cwd: "/w", model: { modelId: "m", provider: "p" }, thinkingLevel: "high" },
        local.snapshot(),
      ),
    ).toMatchObject({ cwd: "/w", model: { modelId: "m", provider: "p" }, thinkingLevel: "high" });
  });
});
