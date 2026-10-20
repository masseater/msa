import { Effect } from "effect";
import { dual } from "effect/Function";

import awaitingModule from "../../core/awaiting.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import errors from "../../utils/errors.ts";
import McpManagerView from "./mcp-manager-view.ts";
import type uiTypes from "./ui.types.ts";
const { awaited, awaiting } = awaitingModule;
const { toErrorMessage } = errors;

function showMcpManagerImpl(
  ctx: extensionsTypesTypes.ExtensionCommandContext,
  manage: (ui: uiTypes.McpUi) => Promise<void>,
): Promise<void> {
  return Effect.runPromise(
    awaiting(function* () {
      yield* awaited(
        ctx.ui.custom<void>((tui, theme, keybindings, done) => {
          const view = new McpManagerView(tui, theme, keybindings);
          Effect.runFork(
            Effect.tryPromise(() => manage(view)).pipe(
              Effect.catch((error) =>
                Effect.sync(() => ctx.ui.notify(toErrorMessage(error.cause), "error")),
              ),
              Effect.ensuring(Effect.sync(() => done())),
            ),
          );
          return view;
        }),
      );
    }),
  );
}
const showMcpManager: {
  (
    ctx: extensionsTypesTypes.ExtensionCommandContext,
    manage: (ui: uiTypes.McpUi) => Promise<void>,
  ): Promise<void>;
  (
    manage: (ui: uiTypes.McpUi) => Promise<void>,
  ): (ctx: extensionsTypesTypes.ExtensionCommandContext) => Promise<void>;
} = dual((args: IArguments) => args.length >= 2, showMcpManagerImpl);

const ui = {
  showMcpManager,
};

export default ui;
