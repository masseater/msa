import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

export default function (msa: codingAgentTypes.ExtensionAPI) {
  let currentCtx: codingAgentTypes.ExtensionContext | undefined;

  msa.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
  });

  msa.events.on("my:notification", (data) => {
    const { message, from } = data as { message: string; from: string };
    currentCtx?.ui.notify(`Event from ${from}: ${message}`, "info");
  });

  msa.registerCommand("emit", {
    description: "Emit my:notification event (usage: /emit message)",
    handler: (args, _ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          const message = args.trim() || "hello";
          msa.events.emit("my:notification", { from: "/emit command", message });
        }),
      ),
  });

  msa.on("session_start", () => {
    msa.events.emit("my:notification", {
      from: "event-bus-example",
      message: "Session started",
    });
  });
}
