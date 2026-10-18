import { type ExtensionAPI, keyHint, type Theme } from "@msa/coding-agent";
import { Box, Text } from "@msa/tui";
import { Effect } from "effect";

const ENTRY_TYPE = "debug-provider-events";
const STATUS_KEY = "debug-provider";

interface ProviderDebugEntry {
  provider: string;
  api: string;
  model: string;
  events: unknown[];
}

const renderDebugEntry = (
  entry: { data?: ProviderDebugEntry | undefined },
  { expanded }: { expanded: boolean },
  theme: Theme,
) => {
  const data = entry.data;
  if (data === undefined) {
    return new Text(theme.fg("warning", "[provider debug] Missing event data"), 0, 0);
  }

  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
  const count = `${data.events.length} event${data.events.length === 1 ? "" : "s"}`;
  const expandHint = expanded ? "" : ` (${keyHint("app.tools.expand", "to view events")})`;
  box.addChild(
    new Text(
      `${theme.fg("accent", "[provider debug]")} ${data.provider}/${data.model} (${data.api}) · ${count}${expandHint}`,
      0,
      0,
    ),
  );
  if (expanded) {
    box.addChild(new Text(JSON.stringify(data.events, null, 2), 0, 0));
  }
  return box;
};

interface DebugState {
  enabled: boolean;
  activeEvents: unknown[] | undefined;
  completedEntry: ProviderDebugEntry | undefined;
}

const registerCaptureEvents = (msa: ExtensionAPI, state: DebugState): void => {
  msa.on("turn_start", () => {
    state.activeEvents = state.enabled ? [] : undefined;
  });

  msa.on("provider_stream_event", (event) => {
    state.activeEvents?.push(structuredClone(event.data));
  });

  msa.on("message_end", (event) => {
    if (event.message.role !== "assistant" || state.activeEvents === undefined) return;
    state.completedEntry = {
      provider: event.message.provider,
      api: event.message.api,
      model: event.message.model,
      events: state.activeEvents,
    };
    state.activeEvents = undefined;
  });

  msa.on("turn_end", () => {
    if (state.completedEntry === undefined) return;
    msa.appendEntry<ProviderDebugEntry>(ENTRY_TYPE, state.completedEntry);
    state.completedEntry = undefined;
  });
};

const registerToggleCommand = (msa: ExtensionAPI, state: DebugState): void => {
  msa.registerCommand("debug-provider", {
    description: "Toggle capture of raw provider stream events",
    handler: (args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          const requestedState = args.trim().toLowerCase();
          if (requestedState !== "" && requestedState !== "on" && requestedState !== "off") {
            ctx.ui.notify("Usage: /debug-provider [on|off]", "warning");
            return;
          }

          state.enabled = requestedState === "" ? !state.enabled : requestedState === "on";
          if (!state.enabled) {
            state.activeEvents = undefined;
            state.completedEntry = undefined;
          }
          ctx.ui.setStatus(STATUS_KEY, state.enabled ? "provider debug" : undefined);
          ctx.ui.notify(`Provider event capture ${state.enabled ? "enabled" : "disabled"}`, "info");
        }),
      ),
  });
};

export default function (msa: ExtensionAPI) {
  const state: DebugState = {
    enabled: false,
    activeEvents: undefined,
    completedEntry: undefined,
  };

  msa.registerEntryRenderer<ProviderDebugEntry>(ENTRY_TYPE, renderDebugEntry);
  registerCaptureEvents(msa, state);
  registerToggleCommand(msa, state);
}
