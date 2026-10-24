declare namespace nodeLlamaCppClassifyTypes {
  interface LocalClassifierConfig {
    readonly directory: string;
    readonly endpoints?: { readonly huggingFace?: string } | undefined;
  }
}

export type { nodeLlamaCppClassifyTypes as default };
