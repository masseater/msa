import type { ExtensionAPI } from "@msa/coding-agent";

export default function (msa: ExtensionAPI) {
  let turnCount = 0;

  msa.on("session_start", (_event, ctx) => {
    const theme = ctx.ui.theme;
    ctx.ui.setStatus("status-demo", theme.fg("dim", "Ready"));
  });

  msa.on("turn_start", (_event, ctx) => {
    turnCount++;
    const theme = ctx.ui.theme;
    const spinner = theme.fg("accent", "●");
    const text = theme.fg("dim", ` Turn ${turnCount}...`);
    ctx.ui.setStatus("status-demo", spinner + text);
  });

  msa.on("turn_end", (_event, ctx) => {
    const theme = ctx.ui.theme;
    const check = theme.fg("success", "✓");
    const text = theme.fg("dim", ` Turn ${turnCount} complete`);
    ctx.ui.setStatus("status-demo", check + text);
  });
}
