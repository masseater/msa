import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import errorsModule from "../../utils/errors.ts";
import llamaCatalogSync from "./llama-catalog-sync.ts";
import llamaConnection from "./llama-connection.ts";
import llamaModelActions from "./llama-model-actions.ts";
import type llamaSessionTypes from "./llama-session.types.ts";

const { awaited, awaiting } = awaitingModule;
const { toErrorMessage } = errorsModule;
const { syncCatalog } = llamaCatalogSync;
const { connectionErrorMessage, isConnectionError } = llamaConnection;
const { runModelAction } = llamaModelActions;

const readCatalog = (
  session: llamaSessionTypes.LlamaSession,
): Promise<llamaSessionTypes.ModelInfo[] | undefined> =>
  Effect.runPromise(
    awaiting(function* () {
      while (true) {
        try {
          return yield* awaited(syncCatalog(session));
        } catch (error) {
          const choice = yield* awaited(
            session.ui.connectionError(session.client.serverUrl, connectionErrorMessage(error)),
          );
          if (choice === "close") return undefined;
        }
      }
    }),
  );

const manageModels = (session: llamaSessionTypes.LlamaSession): Promise<void> =>
  Effect.runPromise(
    awaiting(function* () {
      let catalog = yield* awaited(readCatalog(session));
      if (catalog === undefined) return;
      while (true) {
        const action = yield* awaited(session.ui.showModels(session.client.serverUrl, catalog));
        if (action.type === "close") return;
        let actionError: unknown;
        try {
          yield* awaited(runModelAction(session, action, catalog));
        } catch (error) {
          actionError = error;
        }
        const refreshed = yield* awaited(readCatalog(session));
        if (refreshed === undefined) return;
        catalog = refreshed;
        if (actionError !== undefined && !isConnectionError(actionError)) {
          session.ctx.ui.notify(toErrorMessage(actionError), "error");
        }
      }
    }),
  );

const llamaManager = { manageModels };

export default llamaManager;
