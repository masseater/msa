import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import { Clock, Effect } from "effect";

const { Box, Text } = tui;

interface StatusCardData {
  message: string;
  timestamp: number;
}

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerEntryRenderer<StatusCardData>("status-card", (entry, { expanded }, theme) => {
    const data = entry.data ?? {
      message: "No data",
      timestamp: Effect.runSync(Clock.currentTimeMillis),
    };
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(`${theme.fg("accent", "[status]")} ${data.message}`, 0, 0));

    if (expanded) {
      const time = codingAgent.formatLocalTime(data.timestamp, "YYYY-MM-DD HH:mm:ss");
      box.addChild(new Text(theme.fg("dim", time), 0, 0));
    }

    return box;
  });

  msa.registerCommand("status-card", {
    description: "Render a durable status card that is not sent to the LLM",
    handler: (args) =>
      Effect.runPromise(
        Effect.sync(() => {
          msa.appendEntry<StatusCardData>("status-card", {
            message: args.trim() || "Status card",
            timestamp: Effect.runSync(Clock.currentTimeMillis),
          });
        }),
      ),
  });
}
