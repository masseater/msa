import type codingAgentTypes from "@msa/coding-agent/index.types";
import { DateTime } from "effect";

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.on("input", (event, ctx) => {
    if (event.source === "extension") {
      return { action: "continue" };
    }

    if (event.text.startsWith("?quick ")) {
      const query = event.text.slice(7).trim();
      if (query.length === 0) {
        ctx.ui.notify("Usage: ?quick <question>", "warning");
        return { action: "handled" };
      }
      return { action: "transform", text: `Respond briefly in 1-2 sentences: ${query}` };
    }

    if (event.text.toLowerCase() === "ping") {
      ctx.ui.notify("pong", "info");
      return { action: "handled" };
    }
    if (event.text.toLowerCase() === "time") {
      ctx.ui.notify(DateTime.formatLocal(DateTime.nowUnsafe()), "info");
      return { action: "handled" };
    }

    return { action: "continue" };
  });
}
