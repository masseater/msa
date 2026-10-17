import { createRegistry, defineExtension, GenerationTask, hook, ToolTask } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { agentHooks } from "../src/harness/agent.ts";
import { type AppTool, resolve } from "./harness-registry-support.ts";

describe("agent resolution", () => {
  it("collects hooks of the selected extensions in extension order and applies field defaults", () => {
    const local = createRegistry<AppTool>();
    const first = { beforeTool: () => undefined };
    const second = { beforeTool: () => undefined };
    const onYield = { onYield: () => undefined };
    local.install(
      defineExtension<AppTool>({
        name: "a",
        hooks: [hook(ToolTask, first), hook(GenerationTask, onYield)],
      }),
    );
    local.install(defineExtension<AppTool>({ name: "b", hooks: [hook(ToolTask, second)] }));
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
        { model: { provider: "p", modelId: "m" }, thinkingLevel: "high", cwd: "/w" },
        local.snapshot(),
      ),
    ).toMatchObject({ model: { provider: "p", modelId: "m" }, thinkingLevel: "high", cwd: "/w" });
  });
});
