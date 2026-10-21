import type imageResizeCore from "./image-resize-core.ts";

declare namespace imageResizeCoreTypes {
  interface ImageResizeOptions {
    maxWidth?: number;
    maxHeight?: number;
    maxBytes?: number;
    jpegQuality?: number;
  }

  interface ResizedImage {
    data: string;
    mimeType: string;
    originalWidth: number;
    originalHeight: number;
    width: number;
    height: number;
    wasResized: boolean;
  }

  type ResizeImageWorkerResponse =
    | {
        type: typeof imageResizeCore.IMAGE_RESIZE_WORKER_RESPONSE_TYPE;
        result: ResizedImage | null;
      }
    | { type: typeof imageResizeCore.IMAGE_RESIZE_WORKER_RESPONSE_TYPE; error: string };
}

export type { imageResizeCoreTypes as default };
