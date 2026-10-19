import type { ExtensionAPI } from "@msa/coding-agent";
import { Effect } from "effect";

const makeTimeoutSignal = (ms: number): { signal: AbortSignal; cancel: () => void } => {
  const controller = new AbortController();
  const fiber = Effect.runFork(
    Effect.sleep(ms).pipe(Effect.andThen(Effect.sync(() => controller.abort()))),
  );
  return { signal: controller.signal, cancel: () => fiber.interruptUnsafe() };
};

const registerTimedConfirm = (msa: ExtensionAPI): void => {
  msa.registerCommand("timed", {
    description: "Show a timed confirmation dialog (auto-cancels in 5s with countdown)",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const confirmed = yield* Effect.promise(() =>
            ctx.ui.confirm(
              "Timed Confirmation",
              "This dialog will auto-cancel in 5 seconds. Confirm?",
              { timeout: 5000 },
            ),
          );

          if (confirmed) {
            ctx.ui.notify("Confirmed by user!", "info");
          } else {
            ctx.ui.notify("Cancelled or timed out", "info");
          }
        }),
      ),
  });
};

const registerTimedSelect = (msa: ExtensionAPI): void => {
  msa.registerCommand("timed-select", {
    description: "Show a timed select dialog (auto-cancels in 10s with countdown)",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const choice = yield* Effect.promise(() =>
            ctx.ui.select("Pick an option", ["Option A", "Option B", "Option C"], {
              timeout: 10000,
            }),
          );

          if (choice !== undefined && choice.length > 0) {
            ctx.ui.notify(`Selected: ${choice}`, "info");
          } else {
            ctx.ui.notify("Selection cancelled or timed out", "info");
          }
        }),
      ),
  });
};

const registerTimedSignal = (msa: ExtensionAPI): void => {
  msa.registerCommand("timed-signal", {
    description: "Show a timed confirm using AbortSignal (manual approach)",
    handler: (_args, ctx) => {
      const { signal, cancel } = makeTimeoutSignal(5000);

      ctx.ui.notify("Dialog will auto-cancel in 5 seconds...", "info");

      return Effect.runPromise(
        Effect.gen(function* () {
          const confirmed = yield* Effect.promise(() =>
            ctx.ui.confirm(
              "Timed Confirmation",
              "This dialog will auto-cancel in 5 seconds. Confirm?",
              { signal },
            ),
          );

          if (confirmed) {
            ctx.ui.notify("Confirmed by user!", "info");
          } else if (signal.aborted) {
            ctx.ui.notify("Dialog timed out (auto-cancelled)", "warning");
          } else {
            ctx.ui.notify("Cancelled by user", "info");
          }
        }),
      ).finally(cancel);
    },
  });
};

export default function (msa: ExtensionAPI) {
  registerTimedConfirm(msa);
  registerTimedSelect(msa);
  registerTimedSignal(msa);
}
