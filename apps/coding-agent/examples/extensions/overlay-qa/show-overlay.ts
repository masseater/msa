import type codingAgentTypes from "@msa/coding-agent/index.types";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import type showOverlayTypes from "./show-overlay.types.ts";

const showOverlay = <T>(request: {
  readonly ctx: codingAgentTypes.ExtensionCommandContext;
  readonly factory: showOverlayTypes.OverlayFactory<T>;
  readonly overlayOptions: tuiTypes.OverlayOptions;
}): Promise<T> =>
  request.ctx.ui.custom<T>(request.factory, {
    overlay: true,
    overlayOptions: request.overlayOptions,
  });

const registerOverlayCommand = (request: {
  readonly msa: codingAgentTypes.ExtensionAPI;
  readonly name: string;
  readonly description: string;
  readonly overlayOptions: tuiTypes.OverlayOptions;
  readonly component: (
    ctx: codingAgentTypes.ExtensionCommandContext,
  ) => showOverlayTypes.OverlayFactory<void>;
}): void => {
  request.msa.registerCommand(request.name, {
    description: request.description,
    handler: (_args: string, ctx: codingAgentTypes.ExtensionCommandContext) =>
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

const showOverlayModule = {
  registerOverlayCommand,
  showOverlay,
};

export default showOverlayModule;
