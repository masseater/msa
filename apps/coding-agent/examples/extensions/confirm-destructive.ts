import type {
  ExtensionAPI,
  SessionBeforeSwitchEvent,
  SessionMessageEntry,
} from "@msa/coding-agent";
import { Effect } from "effect";

const registerBeforeSwitch = (msa: ExtensionAPI): void => {
  msa.on("session_before_switch", (event: SessionBeforeSwitchEvent, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (!ctx.hasUI) return;

        if (event.reason === "new") {
          const confirmed = yield* Effect.promise(() =>
            ctx.ui.confirm(
              "Clear session?",
              "This will delete all messages in the current session.",
            ),
          );

          if (!confirmed) {
            ctx.ui.notify("Clear cancelled", "info");
            return { cancel: true };
          }
          return;
        }

        const entries = ctx.sessionManager.getEntries();
        const hasUnsavedWork = entries.some(
          (e): e is SessionMessageEntry => e.type === "message" && e.message.role === "user",
        );

        if (hasUnsavedWork) {
          const confirmed = yield* Effect.promise(() =>
            ctx.ui.confirm(
              "Switch session?",
              "You have messages in the current session. Switch anyway?",
            ),
          );

          if (!confirmed) {
            ctx.ui.notify("Switch cancelled", "info");
            return { cancel: true };
          }
        }
        return undefined;
      }),
    ),
  );
};

const registerBeforeFork = (msa: ExtensionAPI): void => {
  msa.on("session_before_fork", (event, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (!ctx.hasUI) return;

        const choice = yield* Effect.promise(() =>
          ctx.ui.select(`Fork from entry ${event.entryId.slice(0, 8)}?`, [
            "Yes, create fork",
            "No, stay in current session",
          ]),
        );

        if (choice !== "Yes, create fork") {
          ctx.ui.notify("Fork cancelled", "info");
          return { cancel: true };
        }
        return undefined;
      }),
    ),
  );
};

export default function (msa: ExtensionAPI) {
  registerBeforeSwitch(msa);
  registerBeforeFork(msa);
}
