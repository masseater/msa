import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

import AnimationDemoComponent from "./animation-demo-component.ts";
import FocusDemoController from "./focus-demo-controller.ts";
import globalToggleHandle from "./global-toggle-handle.ts";
import PassiveDemoController from "./passive-demo-controller.ts";
import showOverlayModule from "./show-overlay.ts";
import StackOverlayComponent from "./stack-overlay-component.ts";
import StreamingInputController from "./streaming-input-controller.ts";
import ToggleDemoComponent from "./toggle-demo-component.ts";

const { showOverlay } = showOverlayModule;
const { setGlobalToggleHandle } = globalToggleHandle;
const registerAnimation = (msa: codingAgentTypes.ExtensionAPI): void => {
  msa.registerCommand("overlay-animation", {
    description: "Test real-time animation in overlay (~30 FPS)",
    handler: (_args: string, ctx: codingAgentTypes.ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.promise(() =>
          showOverlay<void>({
            ctx,
            factory: (tui, theme, _kb, done) => new AnimationDemoComponent(tui, theme, done),
            overlayOptions: { anchor: "center", maxHeight: 20, width: 50 },
          }),
        ),
      ),
  });
};

const showStacked = (ctx: codingAgentTypes.ExtensionCommandContext, layer: 1 | 2 | 3) => {
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
      overlayOptions: { anchor: "center", maxHeight: 15, offsetX, offsetY, width: 50 },
    }),
  );
};

const registerStack = (msa: codingAgentTypes.ExtensionAPI): void => {
  msa.registerCommand("overlay-stack", {
    description: "Test stacked overlays",
    handler: (_args: string, ctx: codingAgentTypes.ExtensionCommandContext) =>
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

const registerToggle = (msa: codingAgentTypes.ExtensionAPI): void => {
  msa.registerCommand("overlay-toggle", {
    description: "Test overlay toggle (press 't' to toggle visibility)",
    handler: (_args: string, ctx: codingAgentTypes.ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            ctx.ui.custom<void>(
              (tui, theme, _kb, done) => new ToggleDemoComponent(tui, theme, done),
              {
                onHandle: (handle) => setGlobalToggleHandle(handle),
                overlay: true,
                overlayOptions: { anchor: "center", width: 50 },
              },
            ),
          );
          setGlobalToggleHandle(null);
        }),
      ),
  });
};

const registerPassive = (msa: codingAgentTypes.ExtensionAPI): void => {
  msa.registerCommand("overlay-passive", {
    description: "Test non-capturing overlay (passive info panel alongside active overlay)",
    handler: (_args: string, ctx: codingAgentTypes.ExtensionCommandContext) =>
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

const registerFocus = (msa: codingAgentTypes.ExtensionAPI): void => {
  msa.registerCommand("overlay-focus", {
    description: "Test focus cycling, input routing, dismissal, and rendering order with overlays",
    handler: (_args: string, ctx: codingAgentTypes.ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          ctx.ui.setEditorText("");
          yield* Effect.promise(() =>
            showOverlay<void>({
              ctx,
              factory: (tui, theme, _kb, done) => new FocusDemoController(tui, theme, done),
              overlayOptions: { anchor: "bottom-center", margin: { bottom: 1 }, width: 55 },
            }),
          );
        }),
      ),
  });
};

const registerStreaming = (msa: codingAgentTypes.ExtensionAPI): void => {
  msa.registerCommand("overlay-streaming", {
    description: "Multiple input panels with simulated streaming (Tab to cycle focus)",
    handler: (_args: string, ctx: codingAgentTypes.ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.gen(function* () {
          ctx.ui.setEditorText("");
          yield* Effect.promise(() =>
            showOverlay<void>({
              ctx,
              factory: (tui, theme, _kb, done) => new StreamingInputController(tui, theme, done),
              overlayOptions: { anchor: "bottom-center", margin: { bottom: 1 }, width: 60 },
            }),
          );
        }),
      ),
  });
};

const registerEffectCommands = (msa: codingAgentTypes.ExtensionAPI): void => {
  registerAnimation(msa);
  registerStack(msa);
  registerToggle(msa);
  registerPassive(msa);
  registerFocus(msa);
  registerStreaming(msa);
};

const commandsEffects = {
  registerEffectCommands,
};

export default commandsEffects;
