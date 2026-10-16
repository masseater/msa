import type { ExtensionAPI } from "@msa/coding-agent";

export default function widgetPlacementExtension(msa: ExtensionAPI) {
  msa.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget("widget-above", ["Above editor widget"]);
    ctx.ui.setWidget("widget-below", ["Below editor widget"], { placement: "belowEditor" });
  });
}
