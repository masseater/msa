import * as Effect from "effect/Effect";

import awaitingModule from "../../core/awaiting.ts";
import HuggingFaceClient from "./hugging-face-client.ts";
import huggingface from "./huggingface.ts";
import type huggingfaceTypes from "./huggingface.types.ts";
import llamaCatalogSync from "./llama-catalog-sync.ts";
import llamaProgress from "./llama-progress.ts";
import llamaQuantization from "./llama-quantization.ts";
import type llamaSessionTypes from "./llama-session.types.ts";
import type uiTypes from "./ui.types.ts";

const { awaited, awaiting } = awaitingModule;
const { findHuggingFaceToken } = huggingface;
const { syncCatalog } = llamaCatalogSync;
const { downloadWithProgress } = llamaProgress;
const { chooseQuantization } = llamaQuantization;

function parseHuggingFaceModel(value: string): { repository: string; quantization?: string } {
  const colon = value.indexOf(":", value.indexOf("/") + 1);
  return colon < 0
    ? { repository: value }
    : { quantization: value.slice(colon + 1), repository: value.slice(0, colon) };
}

const acceptsGatedAccess = (
  ui: uiTypes.LlamaUi,
  details: huggingfaceTypes.HuggingFaceModelDetails,
): Promise<boolean> => {
  if (details.gated === false) return Effect.runPromise(Effect.succeed(true));
  const approval =
    details.gated === "manual" ? "Manual approval is required" : "Accept the access terms";
  return ui
    .select(
      `Hugging Face access required\n${details.id}\n\n${approval} at:\nhttps://huggingface.co/${details.id}\n\nThe llama.cpp server needs HF_TOKEN with access.`,
      ["Continue", "Back"],
    )
    .then((choice) => choice === "Continue");
};

const downloadModel = (session: llamaSessionTypes.LlamaSession): Promise<void> =>
  Effect.runPromise(
    awaiting(function* () {
      const { ctx, ui } = session;
      const huggingFace = new HuggingFaceClient(yield* awaited(findHuggingFaceToken()));
      const selected = yield* awaited(
        ui.searchModels((query, signal) => huggingFace.search(query, signal)),
      );
      if (selected === undefined || selected === "") return;
      const parsed = parseHuggingFaceModel(selected);
      ui.showStatus("Loading model details", parsed.repository);
      const details = yield* awaited(huggingFace.details(parsed.repository));
      if (!(yield* awaited(acceptsGatedAccess(ui, details)))) return;
      const chosen = yield* awaited(chooseQuantization(ui, details, parsed.quantization));
      if (chosen === undefined) return;
      const { result, model } = yield* awaited(
        downloadWithProgress(session, details, chosen.quantization),
      );
      if (result.cancelled) return;
      yield* awaited(syncCatalog(session, result.value));
      ctx.ui.notify(`Downloaded ${model}`);
    }),
  );

const llamaDownload = { downloadModel };

export default llamaDownload;
