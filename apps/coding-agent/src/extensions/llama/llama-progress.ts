import type huggingfaceTypes from "./huggingface.types.ts";
import type llamaSessionTypes from "./llama-session.types.ts";
import uiModule from "./ui.ts";

const { runWithProgress } = uiModule;

function downloadWithProgress(
  { ui, client }: llamaSessionTypes.LlamaSession,
  details: huggingfaceTypes.HuggingFaceModelDetails,
  quantization: string | undefined,
) {
  const model =
    quantization !== undefined && quantization !== ""
      ? `${details.id}:${quantization}`
      : details.id;
  return runWithProgress(ui, {
    cancel: () => client.unload(model),
    cancelMessage: model,
    cancelTitle: "Stop download?",
    initialMessage: "Starting…",
    model,
    run: (signal, update) => client.downloadAndWait(model, update, signal),
    title: "Downloading model",
  }).then((result) => ({ model, result }));
}

function loadWithProgress(
  { ui, client }: llamaSessionTypes.LlamaSession,
  target: llamaSessionTypes.ModelInfo,
) {
  return runWithProgress(ui, {
    cancel: () => client.unload(target.id),
    cancelMessage: target.id,
    cancelTitle: "Stop loading?",
    initialMessage: "Starting…",
    model: target.id,
    run: (signal, update) => client.loadAndWait(target.id, update, signal),
    title: "Loading model",
  });
}

const llamaProgress = { downloadWithProgress, loadWithProgress };

export default llamaProgress;
