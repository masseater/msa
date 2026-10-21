import type arminTypes from "../armin.types.ts";
import type borderedLoaderTypes from "../bordered-loader.types.ts";
import type customEditorTypes from "../custom-editor.types.ts";
import type dynamicBorderTypes from "../dynamic-border.types.ts";
import type footerTypes from "../footer.types.ts";

declare namespace componentsChromeKitTypes {
  type ArminComponent = arminTypes.ArminComponent;
  type BorderedLoader = borderedLoaderTypes.BorderedLoader;
  type CustomEditor = customEditorTypes.CustomEditor;
  type CustomEditorOptions = customEditorTypes.CustomEditorOptions;
  type DynamicBorder = dynamicBorderTypes.DynamicBorder;
  type FooterComponent = footerTypes.FooterComponent;
}

export type { componentsChromeKitTypes as default };
