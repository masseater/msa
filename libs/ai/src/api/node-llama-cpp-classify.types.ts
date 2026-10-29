import type { Semaphore } from "effect";
import type { ChatWrapper, LlamaContextSequence, LlamaModel, Token } from "node-llama-cpp";

declare namespace nodeLlamaCppClassifyTypes {
  interface LocalClassifierConfig {
    readonly directory: string;
    readonly loadBindings?: (() => Promise<typeof import("node-llama-cpp")>) | undefined;
    readonly download?: boolean | undefined;
    readonly endpoints?: { readonly huggingFace?: string } | undefined;
  }

  interface LoadedModel {
    readonly model: LlamaModel;
    readonly sequence: LlamaContextSequence;
    readonly chatWrapper: ChatWrapper;
    readonly lock: Semaphore.Semaphore;
    readonly labelTokens: Map<string, Token | undefined>;
  }
}

export type { nodeLlamaCppClassifyTypes as default };
