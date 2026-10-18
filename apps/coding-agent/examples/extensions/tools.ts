import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@msa/coding-agent";
import { getSettingsListTheme } from "@msa/coding-agent";
import { Container, type SettingItem, SettingsList } from "@msa/tui";

interface ToolsState {
  enabledTools: string[];
}

export default function toolsExtension(msa: ExtensionAPI) {
  let enabledTools: Set<string> = new Set();
  let allTools: ToolInfo[] = [];

  function persistState() {
    msa.appendEntry<ToolsState>("tools-config", {
      enabledTools: Array.from(enabledTools),
    });
  }

  function applyTools() {
    msa.setActiveTools(Array.from(enabledTools));
  }

  function restoreFromBranch(ctx: ExtensionContext) {
    allTools = msa.getAllTools();

    const branchEntries = ctx.sessionManager.getBranch();
    let savedTools: string[] | undefined;

    for (const entry of branchEntries) {
      if (entry.type === "custom" && entry.customType === "tools-config") {
        const data = entry.data as ToolsState | undefined;
        if (data?.enabledTools !== undefined && data?.enabledTools.length > 0) {
          savedTools = data.enabledTools;
        }
      }
    }

    if (savedTools !== undefined && savedTools.length > 0) {
      const allToolNames = allTools.map((t) => t.name);
      enabledTools = new Set(savedTools.filter((t: string) => allToolNames.includes(t)));
      applyTools();
    } else {
      enabledTools = new Set(msa.getActiveTools());
    }
  }

  msa.registerCommand("tools", {
    description: "Enable/disable tools",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/tools requires TUI mode", "error");
        return;
      }

      allTools = msa.getAllTools();

      await ctx.ui.custom((tui, theme, _kb, done) => {
        const items: SettingItem[] = allTools.map((tool) => ({
          id: tool.name,
          label: tool.name,
          currentValue: enabledTools.has(tool.name) ? "enabled" : "disabled",
          values: ["enabled", "disabled"],
        }));

        const container = new Container();
        container.addChild(
          new (class {
            render(_width: number) {
              return [theme.fg("accent", theme.bold("Tool Configuration")), ""];
            }
            invalidate() {}
          })(),
        );

        const settingsList = new SettingsList(
          items,
          Math.min(items.length + 2, 15),
          getSettingsListTheme(),
          (id, newValue) => {
            if (newValue === "enabled") {
              enabledTools.add(id);
            } else {
              enabledTools.delete(id);
            }
            applyTools();
            persistState();
          },
          () => {
            done(undefined);
          },
        );

        container.addChild(settingsList);

        const component = {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            settingsList.handleInput?.(data);
            tui.requestRender();
          },
        };

        return component;
      });
    },
  });

  msa.on("session_start", async (_event, ctx) => {
    restoreFromBranch(ctx);
  });

  msa.on("session_tree", async (_event, ctx) => {
    restoreFromBranch(ctx);
  });
}
