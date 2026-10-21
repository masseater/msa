import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import llamaCatalogSync from "./llama-catalog-sync.ts";
import llamaConnection from "./llama-connection.ts";
import llamaDownload from "./llama-download.ts";
import llamaProgress from "./llama-progress.ts";
import type llamaSessionTypes from "./llama-session.types.ts";

const { awaited, awaiting } = awaitingModule;
const { syncCatalog } = llamaCatalogSync;
const { modelIsLoaded } = llamaConnection;
const { downloadModel } = llamaDownload;
const { loadWithProgress } = llamaProgress;

type Session = llamaSessionTypes.LlamaSession;
type ModelInfo = llamaSessionTypes.ModelInfo;

const chooseReplace = (session: Session, loaded: readonly ModelInfo[]) =>
  Effect.runPromise(
    awaiting(function* () {
      if (loaded.length === 0) return false;
      const choice = yield* awaited(
        session.ui.select(`${loaded.length} model${loaded.length === 1 ? " is" : "s are"} loaded`, [
          "Unload all and load",
          "Keep loaded and load",
          "Cancel",
        ]),
      );
      if (choice === undefined || choice === "" || choice === "Cancel") return undefined;
      return choice === "Unload all and load";
    }),
  );

const restoreLoaded = (session: Session, loaded: readonly ModelInfo[]): Promise<void> =>
  Effect.runPromise(
    awaiting(function* () {
      session.ctx.ui.notify("Restoring previously loaded models");
      for (const model of loaded) yield* awaited(session.client.loadAndWait(model.id, () => {}));
      yield* awaited(syncCatalog(session));
    }),
  );

const loadModel = (session: Session, catalog: ModelInfo[], target: ModelInfo): Promise<void> =>
  Effect.runPromise(
    awaiting(function* () {
      const loaded = catalog.filter((model) => model.id !== target.id && modelIsLoaded(model));
      const replace = yield* awaited(chooseReplace(session, loaded));
      if (replace === undefined) return;
      if (replace) {
        for (const model of loaded) yield* awaited(session.client.unloadAndWait(model.id));
      }
      try {
        const result = yield* awaited(loadWithProgress(session, target));
        if (result.cancelled) {
          if (replace) yield* awaited(restoreLoaded(session, loaded));
          return;
        }
        const refreshed = yield* awaited(syncCatalog(session));
        const loadedModel = refreshed.find((model) => model.id === target.id);
        session.ctx.ui.notify(
          loadedModel?.status.value === "loaded"
            ? `Loaded ${target.id}`
            : `Load started for ${target.id}`,
        );
      } catch (error) {
        if (replace) yield* awaited(restoreLoaded(session, loaded).catch(() => {}));
        throw error;
      }
    }),
  );

const unloadModel = (session: Session, model: ModelInfo): Promise<void> =>
  Effect.runPromise(
    awaiting(function* () {
      if (!(yield* awaited(session.ui.confirm("Unload model?", model.id)))) return;
      yield* awaited(session.client.unloadAndWait(model.id));
      yield* awaited(syncCatalog(session));
      session.ctx.ui.notify(`Unloaded ${model.id}`);
    }),
  );

const runModelAction = (
  session: Session,
  action: Exclude<llamaSessionTypes.ManagerAction, { type: "close" }>,
  catalog: ModelInfo[],
): Promise<void> => {
  if (action.type === "download") return downloadModel(session);
  if (modelIsLoaded(action.model)) return unloadModel(session, action.model);
  if (action.model.status.value === "unloaded") return loadModel(session, catalog, action.model);
  session.ctx.ui.notify(`${action.model.id} is ${action.model.status.value}`, "warning");
  return Effect.runPromise(Effect.void);
};

const llamaModelActions = { runModelAction };

export default llamaModelActions;
