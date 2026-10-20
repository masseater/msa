import type imageResizeCoreTypes from "./image-resize-core.types.ts";

declare namespace imageResizeTypes {
  type ImageResizeOptions = imageResizeCoreTypes.ImageResizeOptions;

  type ResizedImage = imageResizeCoreTypes.ResizedImage;
}

export type { imageResizeTypes as default };
