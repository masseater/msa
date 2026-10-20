import type SingleLineClass from "./single-line.ts";
import type VisualLinePreviewClass from "./visual-line-preview.ts";

declare namespace visualTruncateTypes {
  interface VisualTruncateResult {
    visualLines: string[];
    skippedCount: number;
  }

  interface VisualLinePreviewOptions {
    text: string;
    maxVisualLines: number;
    keep: "start" | "end";
    formatHint: (hidden: number) => string;
  }

  type SingleLine = (typeof SingleLineClass)["prototype"];

  type VisualLinePreview = (typeof VisualLinePreviewClass)["prototype"];
}

export type { visualTruncateTypes as default };
