import type exportTypesTypes from "./export-types.ts";

declare namespace exportHtmlTypes {
  type ExportOptions = exportTypesTypes.ExportOptions;

  type ToolHtmlRenderer = exportTypesTypes.ToolHtmlRenderer;
}

export type { exportHtmlTypes as default };
