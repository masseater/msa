import type agentTypes from "@msa/agent-core/index.types";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import settingsDefaults from "../../core/settings-defaults.ts";
import toolPart1 from "./tool-part1.ts";
import toolPart2 from "./tool-part2.ts";
import type toolTypes from "./tool.types.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;
const { CODEMODE_TOOL_NAME, DEFAULT_CODEMODE_INLINE_BUDGET, getCodemodeCallableTools } = toolPart1;
const { createCodemodeDescription, describeScriptCall } = toolPart2;

function prepareCodemodeLoadout(
  loadout: extensionsTypesTypes.ToolLoadout,
  options: toolTypes.CodemodeToolOptions,
): extensionsTypesTypes.ToolLoadoutChanges {
  const mode = options.getMode?.() ?? SETTINGS_DEFAULTS.codemode.mode;
  const isDirect = (tool: agentTypes.AgentTool) => loadout.getExposure(tool.name) === "direct";
  const callable = getCodemodeCallableTools(loadout.callable);
  const callableNames = new Set(callable.map((tool) => tool.name));
  const descriptions: Record<string, string> = {};
  if (mode === "on") {
    for (const tool of loadout.declared) {
      if (callableNames.has(tool.name)) descriptions[tool.name] = describeScriptCall(tool);
    }
  }
  const listed = mode === "only" ? callable : callable.filter((tool) => !isDirect(tool));
  const namespaces = new Map(
    listed.flatMap((tool) => {
      const namespace = loadout.getNamespace(tool.name);
      return namespace === undefined ? [] : [[tool.name, namespace] as const];
    }),
  );
  const guidelines = new Map(
    listed.map((tool) => [tool.name, loadout.getPromptGuidelines(tool.name)] as const),
  );
  descriptions[CODEMODE_TOOL_NAME] = createCodemodeDescription(listed, {
    deferred: new Set(
      listed
        .filter((tool) => loadout.getExposure(tool.name) === "deferred")
        .map((tool) => tool.name),
    ),
    guidelines,
    inlineBudget: options.getInlineBudget?.() ?? DEFAULT_CODEMODE_INLINE_BUDGET,
    models: options.models === true,
    namespaces,
  });
  const declaredNames = new Set(loadout.declared.map((tool) => tool.name));
  return {
    descriptions,
    hiddenDeclarations:
      mode === "only"
        ? callable
            .filter((tool) => isDirect(tool) && declaredNames.has(tool.name))
            .map((tool) => tool.name)
        : [],
  };
}

const DISCOVERY_GLOBALS = /\b(searchTools|describeNamespace|describeTool|ALL_TOOLS)\b/u;

function getScriptReach(code: unknown): "all" | readonly string[] {
  if (typeof code !== "string") return [];
  return DISCOVERY_GLOBALS.test(code) ? "all" : (code.match(/\w+/gu) ?? []);
}

const toolPart3 = {
  getScriptReach,
  prepareCodemodeLoadout,
};

export default toolPart3;
