import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import toolNames from "../src/core/orchestrator/tool-names.ts";
import type sdkTypes from "../src/core/sdk.types.ts";
import defaultToolsSettingSupport from "./default-tools-setting-support.ts";

const { ORCHESTRATOR_TOOL_NAMES } = toolNames;

const { cleanupDirs, createSession, prepareDirs } = defaultToolsSettingSupport;

const { awaited, runTest } = testing;

const appliesNameAndNameToolOptionsToSetup = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const inactiveTool: sdkTypes.InlineExtension = (msa) => {
      msa.registerTool({
        defaultActive: false,
        description: "Extension tool registered inactive",
        execute: () =>
          effectRunPromise(
            awaited({ content: [{ text: "ok", type: "text" as const }], details: {} }),
          ),
        label: "Inactive Tool",
        name: "inactive_tool",
        parameters: Type.Object({}),
      });
      msa.registerTool({
        description: "Extension tool registered active",
        execute: () =>
          effectRunPromise(
            awaited({ content: [{ text: "ok", type: "text" as const }], details: {} }),
          ),
        label: "Active Tool",
        name: "active_tool",
        parameters: Type.Object({}),
      });
    };
    return { inactiveTool };
  });

const appliesNameAndNameToolOptionsTo = Effect.gen(function* () {
  const { inactiveTool } = yield* appliesNameAndNameToolOptionsToSetup();

  const session = yield* awaited(
    createSession(["+grep"], { tools: ["+inactive_tool", "-write"] }, [inactiveTool]),
  );
  expect(session.tools.loadout.getActiveToolNames().sort()).toEqual(
    [
      "active_tool",
      "bash",
      "edit",
      "grep",
      "inactive_tool",
      "memory",
      "model_policy",
      "model_upgrade",
      "pr_watch",
      "read",
      ...ORCHESTRATOR_TOOL_NAMES,
    ].sort(),
  );
  session.dispose();

  const toolLess = yield* awaited(
    createSession(["read"], { noTools: "all", tools: ["+inactive_tool"] }, [inactiveTool]),
  );
  expect(toolLess.tools.loadout.getActiveToolNames()).toEqual(["inactive_tool"]);
  toolLess.dispose();
});

describe("defaultTools setting", () => {
  beforeEach(prepareDirs);

  afterEach(cleanupDirs);

  it("applies +name and -name tool options to the default selection", () =>
    runTest(appliesNameAndNameToolOptionsTo));
});
