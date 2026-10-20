import type { ExtensionAPI, ExtensionContext, Theme, ToolInfo } from "@msa/coding-agent";
import { getSettingsListTheme } from "@msa/coding-agent";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

const { Container, SettingsList } = tui;

interface ToolsState {
  enabledTools: string[];
}

interface ExtensionState {
  enabledTools: Set<string>;
  allTools: ToolInfo[];
}

const findSavedTools = (ctx: ExtensionContext): string[] | undefined => {
  let savedTools: string[] | undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === "tools-config") {
      const data = entry.data as ToolsState | undefined;
      if (data?.enabledTools !== undefined && data.enabledTools.length > 0) {
        savedTools = data.enabledTools;
      }
    }
  }
  return savedTools;
};

const makeToolList = (
  theme: Theme,
  state: ExtensionState,
  applyTools: () => void,
  persistState: () => void,
  onDone: () => void,
) => {
  const items: tuiTypes.SettingItem[] = state.allTools.map((tool) => ({
    currentValue: state.enabledTools.has(tool.name) ? "enabled" : "disabled",
    id: tool.name,
    label: tool.name,
    values: ["enabled", "disabled"],
  }));

  const container = new Container();
  container.addChild({
    invalidate: () => {},
    render: () => [theme.fg("accent", theme.bold("Tool Configuration")), ""],
  });

  const settingsList = new SettingsList(
    items,
    Math.min(items.length + 2, 15),
    getSettingsListTheme(),
    (id, newValue) => {
      if (newValue === "enabled") {
        state.enabledTools.add(id);
      } else {
        state.enabledTools.delete(id);
      }
      applyTools();
      persistState();
    },
    onDone,
  );

  container.addChild(settingsList);

  return {
    handleInput: (data: string) => {
      settingsList.handleInput?.(data);
    },
    invalidate: () => {
      container.invalidate();
    },
    render: (width: number) => container.render(width),
  };
};

const registerRestoreEvents = (
  msa: ExtensionAPI,
  restore: (ctx: ExtensionContext) => void,
): void => {
  msa.on("session_start", (_event, ctx) => {
    restore(ctx);
  });

  msa.on("session_tree", (_event, ctx) => {
    restore(ctx);
  });
};

export default function toolsExtension(msa: ExtensionAPI) {
  const state: ExtensionState = { allTools: [], enabledTools: new Set() };

  const persistState = () => {
    msa.appendEntry<ToolsState>("tools-config", {
      enabledTools: Array.from(state.enabledTools),
    });
  };

  const applyTools = () => {
    msa.setActiveTools(Array.from(state.enabledTools));
  };

  const restoreFromBranch = (ctx: ExtensionContext) => {
    state.allTools = msa.getAllTools();
    const savedTools = findSavedTools(ctx);
    if (savedTools === undefined) {
      state.enabledTools = new Set(msa.getActiveTools());
      return;
    }
    const allToolNames = state.allTools.map((t) => t.name);
    state.enabledTools = new Set(savedTools.filter((t) => allToolNames.includes(t)));
    applyTools();
  };

  const openToolList = (ctx: ExtensionContext) =>
    Effect.gen(function* () {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/tools requires TUI mode", "error");
        return;
      }

      state.allTools = msa.getAllTools();

      yield* Effect.promise(() =>
        ctx.ui.custom((_tui, theme, _kb, done) =>
          makeToolList(theme, state, applyTools, persistState, () => done(undefined)),
        ),
      );
    });

  msa.registerCommand("tools", {
    description: "Enable/disable tools",
    handler: (_args, ctx) => Effect.runPromise(openToolList(ctx)),
  });

  registerRestoreEvents(msa, restoreFromBranch);
}
