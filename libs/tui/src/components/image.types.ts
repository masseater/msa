import type image from "./image.ts";

declare namespace imageTypes {
  type ImageTranscoder = (base64Data: string, mimeType: string) => string | null;

  interface ImageTheme {
    fallbackColor: (str: string) => string;
  }

  interface ImageOptions {
    maxWidthCells?: number;
    maxHeightCells?: number;
    filename?: string;
    imageId?: number;
  }

  type Image = (typeof image.Image)["prototype"];
}

export type { imageTypes as default };
