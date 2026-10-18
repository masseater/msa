

import type { ExtensionAPI } from "@msa/coding-agent";
import { Box, Text } from "@msa/tui";

interface StatusCardData {
  message: string;
  timestamp: number;
}

export default function (msa: ExtensionAPI) {
  msa.registerEntryRenderer<StatusCardData>("status-card", (entry, { expanded }, theme) => {
    const data = entry.data ?? { message: "No data", timestamp: Date.now() };
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(`${theme.fg("accent", "[status]")} ${data.message}`, 0, 0));

    if (expanded) {
      box.addChild(new Text(theme.fg("dim", new Date(data.timestamp).toLocaleString()), 0, 0));
    }

    return box;
  });

  msa.registerCommand("status-card", {
    description: "Render a durable status card that is not sent to the LLM",
    handler: async (args) => {
      msa.appendEntry<StatusCardData>("status-card", {
        message: args.trim() || "Status card",
        timestamp: Date.now(),
      });
    },
  });
}
