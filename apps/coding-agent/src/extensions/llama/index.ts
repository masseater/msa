import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import llamaConnection from "./llama-connection.ts";
import llamaManager from "./llama-manager.ts";
import providerModule from "./provider.ts";
import uiModule from "./ui.ts";

const { awaited, awaiting } = awaitingModule;
const { createLlamaProvider } = providerModule;
const { showLlamaUi } = uiModule;
const { configuredClient } = llamaConnection;
const { manageModels } = llamaManager;

export default function llamaExtension(msa: extensionsTypesTypes.ExtensionAPI): void {
  const provider = createLlamaProvider();
  msa.registerProvider(provider.provider);
  msa.registerCommand("llama", {
    description: "Manage llama.cpp router models",
    handler: (_args, ctx) =>
      Effect.runPromise(
        awaiting(function* () {
          if (ctx.mode !== "tui") {
            ctx.ui.notify("/llama is available in interactive mode", "warning");
            return;
          }
          const client = yield* awaited(configuredClient(ctx));
          if (client === undefined) return;
          yield* awaited(showLlamaUi(ctx, (ui) => manageModels({ client, ctx, provider, ui })));
        }),
      ),
  });
}
