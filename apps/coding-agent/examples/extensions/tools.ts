import type { ExtensionAPI, ExtensionContext, Theme, ToolInfo } from "@msa/coding-agent";
import { getSettingsListTheme } from "@msa/coding-agent";
import { Container, type SettingItem, SettingsList } from "@msa/tui";
import { Effect } from "effect";

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
  const items: SettingItem[] = state.allTools.map((tool) => ({
    id: tool.name,
    label: tool.name,
    currentValue: state.enabledTools.has(tool.name) ? "enabled" : "disabled",
    values: ["enabled", "disabled"],
  }));

  const container = new Container();
  container.addChild({
    render: () => [theme.fg("accent", theme.bold("Tool Configuration")), ""],
    invalidate: () => {},
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
    render: (width: number) => container.render(width),
    invalidate: () => {
      container.invalidate();
    },
    handleInput: (data: string) => {
      settingsList.handleInput?.(data);
    },
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
  const state: ExtensionState = { enabledTools: new Set(), allTools: [] };

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
