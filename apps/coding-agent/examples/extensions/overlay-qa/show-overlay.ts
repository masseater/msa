import type {
  ExtensionAPI,
  ExtensionCommandContext,
  KeybindingsManager,
  Theme,
} from "@msa/coding-agent";
import type { Component, OverlayOptions, TUI } from "@msa/tui";
import { Effect } from "effect";

export type OverlayFactory<T> = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result: T) => void,
) => Component;

export const showOverlay = <T>(request: {
  readonly ctx: ExtensionCommandContext;
  readonly factory: OverlayFactory<T>;
  readonly overlayOptions: OverlayOptions;
}): Promise<T> =>
  request.ctx.ui.custom<T>(request.factory, {
    overlay: true,
    overlayOptions: request.overlayOptions,
  });

export const registerOverlayCommand = (request: {
  readonly msa: ExtensionAPI;
  readonly name: string;
  readonly description: string;
  readonly overlayOptions: OverlayOptions;
  readonly component: (ctx: ExtensionCommandContext) => OverlayFactory<void>;
}): void => {
  request.msa.registerCommand(request.name, {
    description: request.description,
    handler: (_args: string, ctx: ExtensionCommandContext) =>
      Effect.runPromise(
        Effect.promise(() =>
          showOverlay<void>({
            ctx,
            factory: request.component(ctx),
            overlayOptions: request.overlayOptions,
          }),
        ),
      ),
  });
};
