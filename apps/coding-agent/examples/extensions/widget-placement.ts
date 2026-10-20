import type codingAgentTypes from "@msa/coding-agent/index.types";

export default function widgetPlacementExtension(msa: codingAgentTypes.ExtensionAPI) {
  msa.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget("widget-above", ["Above editor widget"]);
    ctx.ui.setWidget("widget-below", ["Below editor widget"], { placement: "belowEditor" });
  });
}
