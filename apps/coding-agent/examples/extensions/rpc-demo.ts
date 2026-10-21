import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

interface DemoState {
  turnCount: number;
}

const registerStatusEvents = (msa: codingAgentTypes.ExtensionAPI, state: DemoState): void => {
  msa.on("session_start", (event, ctx) => {
    ctx.ui.setTitle(event.reason === "new" ? "msa RPC Demo (new session)" : "msa RPC Demo");
    ctx.ui.setWidget("rpc-demo", ["--- RPC Extension UI Demo ---", "Loaded and ready."]);
    ctx.ui.setStatus("rpc-demo", `Turns: ${state.turnCount}`);
  });

  msa.on("turn_start", (_event, ctx) => {
    state.turnCount++;
    ctx.ui.setStatus("rpc-demo", `Turn ${state.turnCount} running...`);
  });

  msa.on("turn_end", (_event, ctx) => {
    ctx.ui.setStatus("rpc-demo", `Turn ${state.turnCount} done`);
  });
};

const registerGuardEvents = (msa: codingAgentTypes.ExtensionAPI): void => {
  msa.on("tool_call", (event, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (event.toolName !== "bash") return undefined;

        const command = event.input.command as string;
        const isDangerous =
          /\brm\s+(-rf?|--recursive)/iu.test(command) || /\bsudo\b/iu.test(command);

        if (isDangerous) {
          if (!ctx.hasUI) {
            return { block: true, reason: "Dangerous command blocked (no UI)" };
          }

          const choice = yield* Effect.promise(() =>
            ctx.ui.select(`Dangerous command: ${command}`, ["Allow", "Block"]),
          );
          if (choice !== "Allow") {
            ctx.ui.notify("Command blocked by user", "warning");
            return { block: true, reason: "Blocked by user" };
          }
          ctx.ui.notify("Command allowed", "info");
        }

        return undefined;
      }),
    ),
  );

  msa.on("session_before_switch", (event, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (event.reason !== "new") return;
        if (!ctx.hasUI) return;

        const confirmed = yield* Effect.promise(() =>
          ctx.ui.confirm("Clear session?", "All messages will be lost."),
        );
        if (!confirmed) {
          ctx.ui.notify("Clear cancelled", "info");
          return { cancel: true };
        }
        return undefined;
      }),
    ),
  );
};

const registerCommands = (msa: codingAgentTypes.ExtensionAPI): void => {
  msa.registerCommand("rpc-input", {
    description: "Prompt for text input (demonstrates ctx.ui.input in RPC)",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const value = yield* Effect.promise(() =>
            ctx.ui.input("Enter a value", "type something..."),
          );
          if (value !== undefined && value.length > 0) {
            ctx.ui.notify(`You entered: ${value}`, "info");
          } else {
            ctx.ui.notify("Input cancelled", "info");
          }
        }),
      ),
  });

  msa.registerCommand("rpc-editor", {
    description: "Open multi-line editor (demonstrates ctx.ui.editor in RPC)",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const text = yield* Effect.promise(() =>
            ctx.ui.editor("Edit some text", "Line 1\nLine 2\nLine 3"),
          );
          if (text !== undefined && text.length > 0) {
            ctx.ui.notify(`Editor submitted (${text.split("\n").length} lines)`, "info");
          } else {
            ctx.ui.notify("Editor cancelled", "info");
          }
        }),
      ),
  });

  msa.registerCommand("rpc-prefill", {
    description: "Prefill the input editor (demonstrates ctx.ui.setEditorText in RPC)",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          ctx.ui.setEditorText("This text was set by the rpc-demo extension.");
          ctx.ui.notify("Editor prefilled", "info");
        }),
      ),
  });
};

export default function (msa: codingAgentTypes.ExtensionAPI) {
  const state: DemoState = { turnCount: 0 };
  registerStatusEvents(msa, state);
  registerGuardEvents(msa);
  registerCommands(msa);
}
