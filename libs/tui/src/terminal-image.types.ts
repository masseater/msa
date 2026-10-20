declare namespace terminalImageTypes {
  interface ImageRenderOptions {
    maxWidthCells?: number;
    maxHeightCells?: number;
    preserveAspectRatio?: boolean;
    imageId?: number | undefined;
    moveCursor?: boolean | undefined;
  }

  interface RenderedImage {
    sequence: string;
    columns: number;
    rows: number;
    imageId?: number | undefined;
  }
}

export type { terminalImageTypes as default };
