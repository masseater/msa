declare namespace nodeLlamaCppClassifyTypes {
  interface LocalClassifierConfig {
    readonly directory: string;
    readonly loadBindings?: (() => Promise<typeof import("node-llama-cpp")>) | undefined;
    readonly download?: boolean | undefined;
    readonly endpoints?: { readonly huggingFace?: string } | undefined;
  }
}

export type { nodeLlamaCppClassifyTypes as default };
