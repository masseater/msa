import type { ExtensionAPI, ExtensionCommandContext } from "@msa/coding-agent";
import { Effect } from "effect";

import { AnimationDemoComponent } from "./animation-demo-component.ts";
import { FocusDemoController } from "./focus-demo-controller.ts";
import { setGlobalToggleHandle } from "./global-toggle-handle.ts";
import { PassiveDemoController } from "./passive-demo-controller.ts";
import { showOverlay } from "./show-overlay.ts";
import { StackOverlayComponent } from "./stack-overlay-component.ts";
import { StreamingInputController } from "./streaming-input-controller.ts";
import { ToggleDemoComponent } from "./toggle-demo-component.ts";

const registerAnimation = (msa: ExtensionAPI): void => {
  msa.registerCommand("overlay-animation", {
    description: "Test real-time animation in overlay (~30 FPS)",
    handler: (_args: string, ctx: ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.promise(() =>
          showOverlay<void>({
            ctx,
            factory: (tui, theme, _kb, done) => new AnimationDemoComponent(tui, theme, done),
            overlayOptions: { anchor: "center", width: 50, maxHeight: 20 },
          }),
        ),
      ),
  });
};

const showStacked = (ctx: ExtensionCommandContext, layer: 1 | 2 | 3) => {
  const labels = {
    1: { label: "back (red border)", offsetX: -8, offsetY: -4 },
    2: { label: "middle (green border)", offsetX: 0, offsetY: 0 },
    3: { label: "front (blue border)", offsetX: 8, offsetY: 4 },
  } as const;
  const { label, offsetX, offsetY } = labels[layer];

  return Effect.promise(() =>
    showOverlay<string>({
      ctx,
      factory: (_tui, theme, _kb, done) => new StackOverlayComponent(theme, layer, label, done),
      overlayOptions: { anchor: "center", width: 50, offsetX, offsetY, maxHeight: 15 },
    }),
  );
};

const registerStack = (msa: ExtensionAPI): void => {
  msa.registerCommand("overlay-stack", {
    description: "Test stacked overlays",
    handler: (_args: string, ctx: ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          ctx.ui.notify("Showing overlay 1 (back)...", "info");
          const back = showStacked(ctx, 1);

          yield* Effect.sleep(400);
          ctx.ui.notify("Showing overlay 2 (middle)...", "info");
          const middle = showStacked(ctx, 2);

          yield* Effect.sleep(400);
          ctx.ui.notify("Showing overlay 3 (front)...", "info");
          const front = showStacked(ctx, 3);

          const results = yield* Effect.all([back, middle, front], { concurrency: 3 });
          ctx.ui.notify(`Closed in order: ${results.join(", ")}`, "info");
        }),
      ),
  });
};

const registerToggle = (msa: ExtensionAPI): void => {
  msa.registerCommand("overlay-toggle", {
    description: "Test overlay toggle (press 't' to toggle visibility)",
    handler: (_args: string, ctx: ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            ctx.ui.custom<void>(
              (tui, theme, _kb, done) => new ToggleDemoComponent(tui, theme, done),
              {
                overlay: true,
                overlayOptions: { anchor: "center", width: 50 },
                onHandle: (handle) => setGlobalToggleHandle(handle),
              },
            ),
          );
          setGlobalToggleHandle(null);
        }),
      ),
  });
};

const registerPassive = (msa: ExtensionAPI): void => {
  msa.registerCommand("overlay-passive", {
    description: "Test non-capturing overlay (passive info panel alongside active overlay)",
    handler: (_args: string, ctx: ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          ctx.ui.setEditorText("");
          yield* Effect.promise(() =>
            showOverlay<void>({
              ctx,
              factory: (tui, theme, _kb, done) => new PassiveDemoController(tui, theme, done),
              overlayOptions: { anchor: "center", width: 48 },
            }),
          );
        }),
      ),
  });
};

const registerFocus = (msa: ExtensionAPI): void => {
  msa.registerCommand("overlay-focus", {
    description: "Test focus cycling, input routing, dismissal, and rendering order with overlays",
    handler: (_args: string, ctx: ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          ctx.ui.setEditorText("");
          yield* Effect.promise(() =>
            showOverlay<void>({
              ctx,
              factory: (tui, theme, _kb, done) => new FocusDemoController(tui, theme, done),
              overlayOptions: { anchor: "bottom-center", width: 55, margin: { bottom: 1 } },
            }),
          );
        }),
      ),
  });
};

const registerStreaming = (msa: ExtensionAPI): void => {
  msa.registerCommand("overlay-streaming", {
    description: "Multiple input panels with simulated streaming (Tab to cycle focus)",
    handler: (_args: string, ctx: ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          ctx.ui.setEditorText("");
          yield* Effect.promise(() =>
            showOverlay<void>({
              ctx,
              factory: (tui, theme, _kb, done) => new StreamingInputController(tui, theme, done),
              overlayOptions: { anchor: "bottom-center", width: 60, margin: { bottom: 1 } },
            }),
          );
        }),
      ),
  });
};

export const registerEffectCommands = (msa: ExtensionAPI): void => {
  registerAnimation(msa);
  registerStack(msa);
  registerToggle(msa);
  registerPassive(msa);
  registerFocus(msa);
  registerStreaming(msa);
};
