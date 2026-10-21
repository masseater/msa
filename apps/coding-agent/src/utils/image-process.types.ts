import type imageResizeTypes from "./image-resize.types.ts";

declare namespace imageProcessTypes {
  interface ProcessImageOptions {
    autoResizeImages?: boolean;

    resizeOptions?: imageResizeTypes.ImageResizeOptions | undefined;
  }

  type ProcessImageResult =
    | {
        ok: true;
        data: string;
        mimeType: string;
        hints: string[];
      }
    | {
        ok: false;
        message: string;
      };
}

export type { imageProcessTypes as default };
