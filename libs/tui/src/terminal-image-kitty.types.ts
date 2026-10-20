declare namespace terminalImageKittyTypes {
  interface ImageCellSize {
    columns: number;
    rows: number;
  }

  interface KittyImageMetadata extends ImageCellSize {
    imageId: number;
    widthPx: number;
    heightPx: number;
  }

  interface KittyImagePlacement {
    imageId: number;
    transmissionGeneration: number;
    transmissionBytes: number;
    estimatedDecodedBytes: number;
    rows: number;
    sequence: string;
    replacementLine: string;
  }
}

export type { terminalImageKittyTypes as default };
