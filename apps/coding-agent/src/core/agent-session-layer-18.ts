import AgentSessionLayer17 from "./agent-session-layer-17.ts";
import type extensionsTypes from "./extensions/index.types.ts";
import orchestratorTools from "./orchestrator/tools.ts";
import toolsModule from "./tools/index.ts";
import toolsMemory from "./tools/memory.ts";
import modelPolicy from "./tools/model-policy.ts";
import modelUpgrade from "./tools/model-upgrade.ts";
import prWatchModule from "./tools/pr-watch.ts";
import toolDefinitionWrapper from "./tools/tool-definition-wrapper.ts";

const { createAllToolDefinitions } = toolsModule;
const { createMemoryToolDefinition } = toolsMemory;
const { createModelPolicyToolDefinition } = modelPolicy;
const { createModelUpgradeToolDefinition } = modelUpgrade;
const { createPrWatchToolDefinition } = prWatchModule;
const { createToolDefinitionFromAgentTool } = toolDefinitionWrapper;
const { createOrchestratorToolDefinitions } = orchestratorTools;

export default abstract class AgentSessionLayer18 extends AgentSessionLayer17 {
  protected defaultBaseToolDefinitions(): Record<string, unknown> {
    const bash = {
      commandPrefix: this.settingsManager.getShellCommandPrefix(),
      shellPath: this.settingsManager.getShellPath(),
    };
    return {
      ...createAllToolDefinitions(this.cwd, {
        bash,
        read: { autoResizeImages: this.settingsManager.getImageAutoResize() },
      }),
      ...(this.memoryInternal === undefined
        ? {}
        : { memory: createMemoryToolDefinition(this.memoryInternal) }),
      model_policy: createModelPolicyToolDefinition({
        currentModel: () => this.model,
        modelRuntime: this.modelRuntimeInternal,
        settingsManager: this.settingsManager,
      }),
      model_upgrade: createModelUpgradeToolDefinition({
        modelRuntime: this.modelRuntimeInternal,
        settingsManager: this.settingsManager,
      }),
      pr_watch: createPrWatchToolDefinition(this.prWatchInternal),
    };
  }

  protected resetBaseToolDefinitions(): void {
    const override = this.baseToolsOverride;
    const definitions =
      override === undefined
        ? this.defaultBaseToolDefinitions()
        : Object.fromEntries(
            Object.entries(override).map(([name, tool]) => [
              name,
              createToolDefinitionFromAgentTool(tool),
            ]),
          );
    this.baseToolDefinitions = new Map(
      Object.entries(definitions).map(([name, tool]) => [
        name,
        tool as extensionsTypes.ToolDefinition,
      ]),
    );
    if (this.orchestratorInternal === undefined || override !== undefined) return;
    for (const [name, tool] of Object.entries(
      createOrchestratorToolDefinitions(this.orchestratorInternal),
    ))
      this.baseToolDefinitions.set(name, tool);
  }
}
