declare namespace nodeLlamaCppClassifyTypes {
  type LocalModelEvent =
    | { readonly type: "download-started"; readonly uri: string }
    | {
        readonly type: "download-progress";
        readonly uri: string;
        readonly downloadedBytes: number;
        readonly totalBytes: number;
      }
    | { readonly type: "ready"; readonly uri: string; readonly path: string }
    | { readonly type: "failed"; readonly uri: string; readonly message: string };

  interface LocalClassifierConfig {
    readonly directory: string;
    readonly endpoints?: { readonly huggingFace?: string } | undefined;
    readonly onEvent?: ((event: LocalModelEvent) => void) | undefined;
  }
}

export type { nodeLlamaCppClassifyTypes as default };
