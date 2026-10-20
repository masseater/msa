import type { ExtensionAPI, ExtensionFactory } from "../../core/extensions/types.ts";
import { SETTINGS_DEFAULTS } from "../../core/settings-defaults.ts";
import type { CodemodeMode } from "../../core/settings-manager.ts";
import { createCodemodeToolDefinition } from "./tool.ts";

export interface CodemodeExtensionOptions {
  mode?: CodemodeMode;

  inlineBudget?: number;

  models?: boolean;
}

function readMode(msa: ExtensionAPI): CodemodeMode {
  return msa.getSettings().codemode?.mode === "only" ? "only" : SETTINGS_DEFAULTS.codemode.mode;
}

function readInlineBudget(msa: ExtensionAPI): number | undefined {
  const budget = msa.getSettings().codemode?.inlineBudget;
  return typeof budget === "number" && Number.isFinite(budget) && budget >= 0 ? budget : undefined;
}

export function createCodemodeExtension(options: CodemodeExtensionOptions = {}): ExtensionFactory {
  return (msa) => {
    msa.registerTool({
      ...createCodemodeToolDefinition({
        appendEntry: (customType, data) => msa.appendEntry(customType, data),
        getInlineBudget: () => options.inlineBudget ?? readInlineBudget(msa),
        getMode: () => options.mode ?? readMode(msa),
        getToolGuidelines: () =>
          new Map(
            msa.getAllTools().map((tool) => [tool.name, tool.promptGuidelines ?? []] as const),
          ),
        getToolNamespace: (name) => msa.getAllTools().find((tool) => tool.name === name)?.namespace,
        models: options.models ?? true,
      }),
      defaultActive: false,
    });
  };
}

export default createCodemodeExtension();
