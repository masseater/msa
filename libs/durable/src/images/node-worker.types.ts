import type imageTypes from "../tools/image.types.ts";

declare namespace nodeWorkerTypes {
  type PrepareRequest = {
    readonly id: number;
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    readonly limits: imageTypes.ImageLimits;
  };

  type PrepareReply =
    | { readonly id: number; readonly result: imageTypes.PreparedImage | undefined }
    | { readonly id: number; readonly error: string };
}

export type { nodeWorkerTypes as default };
