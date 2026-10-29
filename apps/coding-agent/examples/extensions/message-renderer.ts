import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import { Clock, Effect } from "effect";

const { Box, Text } = tui;

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerMessageRenderer("status-update", (message, { expanded, outputPad }, theme) => {
    const details = message.details as { level: string; timestamp: number } | undefined;
    const level = details?.level ?? "info";

    const color = level === "error" ? "error" : level === "warn" ? "warning" : "success";
    const prefix = theme.fg(color, `[${level.toUpperCase()}]`);

    let text = `${prefix} ${message.content}`;

    if (expanded && details?.timestamp !== undefined) {
      const time = codingAgent.formatLocalTime(details.timestamp, "YYYY-MM-DD HH:mm:ss");
      text += `\n${theme.fg("dim", `  at ${time}`)}`;
    }

    const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(text, 0, 0));
    return box;
  });

  msa.registerCommand("status", {
    description: "Send a status message (usage: /status [warn|error] message)",
    handler: (args, _ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          const parts = args.trim().split(/\s+/u);
          let level = "info";
          let content = args.trim();

          if (parts[0] === "warn" || parts[0] === "error") {
            level = parts[0];
            content = parts.slice(1).join(" ") || "Status update";
          }

          msa.sendMessage({
            content,
            customType: "status-update",
            details: { level, timestamp: Effect.runSync(Clock.currentTimeMillis) },
            display: true,
          });
        }),
      ),
  });
}
