import type aiTypes from "@msa/ai/index.types";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

const { truncateToWidth, visibleWidth } = tuiModule;

const makeFooter =
  (ctx: codingAgentTypes.ExtensionContext) =>
  (
    tui: tuiTypes.TUI,
    theme: codingAgentTypes.Theme,
    footerData: codingAgentTypes.ReadonlyFooterDataProvider,
  ) => {
    const unsub = footerData.onBranchChange(() => tui.requestRender());

    return {
      dispose: unsub,
      invalidate() {},
      render(width: number): string[] {
        let input = 0;
        let output = 0;
        let cost = 0;
        for (const e of ctx.sessionManager.getBranch()) {
          if (e.type === "message" && e.message.role === "assistant") {
            const m = e.message as aiTypes.AssistantMessage;
            input += m.usage.input;
            output += m.usage.output;
            cost += m.usage.cost.total;
          }
        }

        const branch = footerData.getGitBranch();
        const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

        const left = theme.fg("dim", `↑${fmt(input)} ↓${fmt(output)} $${cost.toFixed(3)}`);
        const branchStr = branch !== null && branch.length > 0 ? ` (${branch})` : "";
        const right = theme.fg("dim", `${ctx.model?.id || "no-model"}${branchStr}`);

        const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
        return [truncateToWidth(left + pad + right, width)];
      },
    };
  };

export default function (msa: codingAgentTypes.ExtensionAPI) {
  let enabled = false;

  msa.registerCommand("footer", {
    description: "Toggle custom footer",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          enabled = !enabled;

          if (enabled) {
            ctx.ui.setFooter(makeFooter(ctx));
            ctx.ui.notify("Custom footer enabled", "info");
          } else {
            ctx.ui.setFooter(undefined);
            ctx.ui.notify("Default footer restored", "info");
          }
        }),
      ),
  });
}
