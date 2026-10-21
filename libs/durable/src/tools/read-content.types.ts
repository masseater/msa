import type imageTypes from "./image.types.ts";

declare namespace readContentTypes {
  type ReadRequest = {
    readonly path: string;
    readonly offset: number | undefined;
    readonly limit: number | undefined;
    readonly images: imageTypes.ImageProcessor | undefined;
  };
}

export type { readContentTypes as default };
