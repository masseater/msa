import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import DefaultResourceLoader from "../src/core/default-resource-loader.ts";
import sdk from "../src/core/sdk.ts";
import SessionManager from "../src/core/session-manager.ts";
import SettingsManager from "../src/core/settings-manager.ts";
import toolsModule from "../src/core/tools/index.ts";
import toolDefinitionWrapper from "../src/core/tools/tool-definition-wrapper.ts";

const { createAllToolDefinitions, createAllTools } = toolsModule;
const { wrapToolDefinition } = toolDefinitionWrapper;
const { createAgentSession } = sdk;
const { getModel } = compat;

const { awaited, joinPath, makeTempDir, removePath, runTest, writeTextFile } = testing;

const strictToolNames = ["read", "bash", "powershell", "edit", "write"] as const;

const preservesExplicitOptOutsWhenWrappingDefinitions = () => {
  const definitions = createAllToolDefinitions(process.cwd());
  for (const name of strictToolNames) {
    const definition = definitions[name];
    const override = { ...definition, constrainedSampling: false as const };
    expect(wrapToolDefinition(override).constrainedSampling).toBe(false);
    expect(override.execute).toBe(definition.execute);
    expect(override.prepareArguments).toBe(definition.prepareArguments);
    expect(override.renderCall).toBe(definition.renderCall);
    expect(override.renderResult).toBe(definition.renderResult);
    expect(override.promptGuidelines).toBe(definition.promptGuidelines);
    expect(definition.constrainedSampling).toEqual({
      strict: "prefer",
      type: "json_schema" as const,
    });
  }
};

const partPart1 = (input: { readonly activeTools: string[] }) =>
  Effect.gen(function* () {
    const { activeTools } = input;
    const cwd = yield* makeTempDir("msa-non-strict-tools-");
    const agentDir = joinPath(cwd, "agent");
    const settingsManager = SettingsManager.inMemory({ defaultTools: activeTools });
    const resourceLoader = new DefaultResourceLoader({
      agentDir,
      cwd,
      extensionFactories: [
        (msa) => {
          msa.on("session_start", () => {
            const definitions = createAllToolDefinitions(cwd);
            for (const name of strictToolNames) {
              msa.registerTool({ ...definitions[name], constrainedSampling: false });
            }
            msa.setActiveTools(activeTools);
          });
        },
      ],
      noExtensions: true,
      noPromptTemplates: true,
      noSkills: true,
      noThemes: true,
      settingsManager,
    });
    return { agentDir, cwd, resourceLoader, settingsManager };
  });

describe("strict built-in tools", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "0", "1"])(
    "prefers strict sampling with MSA_EXPERIMENTAL=%s",
    (experimental) => {
      vi.stubEnv("MSA_EXPERIMENTAL", experimental);
      const definitions = createAllToolDefinitions(process.cwd());
      const tools = createAllTools(process.cwd());
      for (const name of strictToolNames) {
        expect(definitions[name].constrainedSampling).toEqual({
          strict: "prefer",
          type: "json_schema" as const,
        });
        expect(tools[name].constrainedSampling).toEqual(definitions[name].constrainedSampling);
      }
      for (const name of ["grep", "find", "ls"] as const) {
        expect(definitions[name].constrainedSampling).toBeUndefined();
      }

      expect(definitions.read.parameters.required).toEqual(["path"]);
      expect(definitions.bash.parameters.required).toEqual(["command"]);
    },
  );

  it(
    "preserves explicit opt-outs when wrapping definitions for execution",
    preservesExplicitOptOutsWhenWrappingDefinitions,
  );
});

describe("strict built-in tools", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([{ activeTools: [] }, { activeTools: ["read"] }, { activeTools: [...strictToolNames] }])(
    "allows extensions to re-register tools without strict sampling: $activeTools",
    ({ activeTools }) =>
      runTest(
        Effect.gen(function* () {
          const { agentDir, cwd, resourceLoader, settingsManager } = yield* partPart1({
            activeTools,
          });
          try {
            yield* awaited(resourceLoader.reload());
            const { session } = yield* awaited(
              createAgentSession({
                agentDir,
                cwd,
                model: getModel("anthropic-api", "claude-sonnet-4-5"),
                resourceLoader,
                sessionManager: SessionManager.inMemory(cwd),
                settingsManager,
              }),
            );
            try {
              const originalPrompt = session.systemPrompt;
              yield* awaited(session.bindExtensions({}));
              expect(session.getActiveToolNames()).toEqual(activeTools);
              expect(session.systemPrompt).toBe(originalPrompt);
              for (const name of strictToolNames) {
                expect(session.getToolDefinition(name)?.constrainedSampling).toBe(false);
              }
              for (const tool of session.agent.state.tools) {
                expect(tool.constrainedSampling).toBe(false);
              }
              if (activeTools.includes("read")) {
                yield* writeTextFile(joinPath(cwd, "sample.txt"), "still works");
                const read = session.agent.state.tools.find((tool) => tool.name === "read")!;
                const result = yield* awaited(read.execute("read-test", { path: "sample.txt" }));
                expect(result.content).toEqual([{ text: "still works", type: "text" as const }]);
              }
            } finally {
              session.dispose();
            }
          } finally {
            yield* removePath(cwd);
          }
        }),
      ),
  );
});
