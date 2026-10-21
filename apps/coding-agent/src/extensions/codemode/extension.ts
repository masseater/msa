import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import settingsDefaults from "../../core/settings-defaults.ts";
import type settingsManagerTypes from "../../core/settings-manager.types.ts";
import type extensionTypes from "./extension.types.ts";
import toolModule from "./tool.ts";

const { SETTINGS_DEFAULTS } = settingsDefaults;
const { createCodemodeToolDefinition } = toolModule;

function readMode(msa: extensionsTypesTypes.ExtensionAPI): settingsManagerTypes.CodemodeMode {
  return msa.getSettings().codemode?.mode === "only" ? "only" : SETTINGS_DEFAULTS.codemode.mode;
}

function readInlineBudget(msa: extensionsTypesTypes.ExtensionAPI): number | undefined {
  const budget = msa.getSettings().codemode?.inlineBudget;
  return typeof budget === "number" && Number.isFinite(budget) && budget >= 0 ? budget : undefined;
}

function createCodemodeExtension(
  options: extensionTypes.CodemodeExtensionOptions = {},
): extensionsTypesTypes.ExtensionFactory {
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

const extension = {
  createCodemodeExtension,
};

export default extension;
