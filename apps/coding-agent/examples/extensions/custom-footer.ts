import type { AssistantMessage } from "@msa/ai";
import type { ExtensionAPI } from "@msa/coding-agent";
import { truncateToWidth, visibleWidth } from "@msa/tui";
import { Effect } from "effect";

export default function (msa: ExtensionAPI) {
  let enabled = false;

  msa.registerCommand("footer", {
    description: "Toggle custom footer",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          enabled = !enabled;

          if (enabled) {
            ctx.ui.setFooter((tui, theme, footerData) => {
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
                      const m = e.message as AssistantMessage;
                      input += m.usage.input;
                      output += m.usage.output;
                      cost += m.usage.cost.total;
                    }
                  }

                  const branch = footerData.getGitBranch();
                  const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

                  const left = theme.fg(
                    "dim",
                    `↑${fmt(input)} ↓${fmt(output)} $${cost.toFixed(3)}`,
                  );
                  const branchStr = branch !== null && branch.length > 0 ? ` (${branch})` : "";
                  const right = theme.fg("dim", `${ctx.model?.id || "no-model"}${branchStr}`);

                  const pad = " ".repeat(
                    Math.max(1, width - visibleWidth(left) - visibleWidth(right)),
                  );
                  return [truncateToWidth(left + pad + right, width)];
                },
              };
            });
            ctx.ui.notify("Custom footer enabled", "info");
          } else {
            ctx.ui.setFooter(undefined);
            ctx.ui.notify("Default footer restored", "info");
          }
        }),
      ),
  });
}
