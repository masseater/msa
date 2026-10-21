import type clientTypes from "./client.types.ts";
import type huggingfaceTypes from "./huggingface.types.ts";

declare namespace uiTypes {
  type LlamaModelInfo = clientTypes.LlamaModelInfo;

  type HuggingFaceModel = huggingfaceTypes.HuggingFaceModel;

  type LlamaManagerAction =
    | { type: "model"; model: clientTypes.LlamaModelInfo }
    | { type: "download" }
    | { type: "close" };

  interface ProgressState extends clientTypes.LlamaProgress {
    title: string;
    model: string;
  }

  interface LlamaUi {
    showModels(
      serverUrl: string,
      models: clientTypes.LlamaModelInfo[],
    ): Promise<LlamaManagerAction>;
    select(title: string, options: string[]): Promise<string | undefined>;
    confirm(title: string, message: string): Promise<boolean>;
    connectionError(serverUrl: string, message: string): Promise<"retry" | "close">;
    searchModels(
      search: (query: string, signal: AbortSignal) => Promise<huggingfaceTypes.HuggingFaceModel[]>,
    ): Promise<string | undefined>;
    showStatus(title: string, message: string): void;
    progress(state: ProgressState): Promise<void>;
    updateProgress(state: ProgressState): void;
  }
}

export type { uiTypes as default };
