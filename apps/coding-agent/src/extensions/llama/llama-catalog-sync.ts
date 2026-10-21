import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import type llamaSessionTypes from "./llama-session.types.ts";
import providerModule from "./provider.ts";

const { awaited, awaiting } = awaitingModule;
const { LLAMA_PROVIDER_ID } = providerModule;

const syncCatalog = (
  session: llamaSessionTypes.LlamaSession,
  catalog?: llamaSessionTypes.ModelInfo[],
): Promise<llamaSessionTypes.ModelInfo[]> =>
  Effect.runPromise(
    awaiting(function* () {
      const { client, ctx, provider } = session;
      const signal = AbortSignal.timeout(15_000);
      const current = catalog ?? (yield* awaited(client.list({ signal })));
      provider.setCatalog(current, client.serverUrl);
      const result = yield* awaited(
        ctx.modelRegistry.refresh({ allowNetwork: true, providers: [LLAMA_PROVIDER_ID], signal }),
      );
      if (result.aborted) throw new Error("Model catalog refresh timed out.");
      const refreshError = result.errors.get(LLAMA_PROVIDER_ID);
      if (refreshError !== undefined) throw refreshError;
      return current;
    }),
  );

const llamaCatalogSync = { syncCatalog };

export default llamaCatalogSync;
