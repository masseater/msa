import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type themeTypes from "../../modes/interactive/theme/theme.types.ts";
import type uiTypes from "./ui.types.ts";

const { Spacer, Text } = tuiModule;

const DOWNLOAD_VALUE = "\0download";
function contextLabel(model: uiTypes.LlamaModelInfo): string | undefined {
  const context = model.meta?.n_ctx ?? model.meta?.n_ctx_train;
  if (context !== undefined && context !== 0)
    return context >= 1000 ? `${Math.round(context / 1000)}k` : String(context);
  const args = model.status.args ?? [];
  for (let index = 0; index < args.length - 1; index++) {
    if (args[index] !== "--ctx-size" && args[index] !== "-c" && args[index] !== "-ctx") continue;
    const value = Number(args[index + 1]);
    if (Number.isFinite(value) && value > 0)
      return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
  }
  return undefined;
}
function modelDescription(model: uiTypes.LlamaModelInfo): string {
  const details: string[] = [];
  const loaded = model.status.value === "loaded" || model.status.value === "sleeping";
  if (loaded) details.push("loaded");
  else if (model.status.value !== "unloaded") details.push(model.status.value);
  const context = loaded ? contextLabel(model) : undefined;
  if (context !== undefined && context !== "") details.push(`${context} context`);
  return details.join(" · ");
}
function modelListItems(models: readonly uiTypes.LlamaModelInfo[]) {
  const sorted = [...models].sort((left, right) => {
    const loaded = Number(right.status.value === "loaded") - Number(left.status.value === "loaded");
    return loaded || left.id.localeCompare(right.id);
  });
  const items: tuiTypes.SelectItem[] = [
    ...sorted.map((model) => ({
      description: modelDescription(model),
      label: model.id,
      value: model.id,
    })),
    {
      description: "Hugging Face owner/repository[:quant]",
      label: "Download model…",
      value: DOWNLOAD_VALUE,
    },
  ];
  return { byId: new Map(sorted.map((model) => [model.id, model])), items };
}

function progressBody(theme: themeTypes.Theme, state: uiTypes.ProgressState): tuiTypes.Component[] {
  const body: tuiTypes.Component[] = [
    new Text(theme.fg("text", state.model), 1, 0),
    new Spacer(1),
    new Text(theme.fg("muted", state.message), 1, 0),
  ];
  if (state.ratio !== undefined) {
    const available = 40;
    const filled = Math.round(Math.max(0, Math.min(1, state.ratio)) * available);
    body.push(
      new Text(
        theme.fg(
          "accent",
          `${"█".repeat(filled)}${"─".repeat(available - filled)} ${Math.round(state.ratio * 100)}%`,
        ),
        1,
        0,
      ),
    );
  }
  if (state.detail !== undefined && state.detail !== "")
    body.push(new Text(theme.fg("dim", state.detail), 1, 0));
  return body;
}

const llamaViewContent = { DOWNLOAD_VALUE, modelListItems, progressBody };

export default llamaViewContent;
