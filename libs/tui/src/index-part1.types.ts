import type { Token as TokenSource } from "marked";

import type autocompleteTypesModule from "./autocomplete-types.ts";
import type colorsTypes from "./colors.types.ts";
import type editorTypes from "./components/editor.types.ts";
import type imageTypes from "./components/image.types.ts";
import type loaderTypes from "./components/loader.types.ts";
import type markdownThemeTypes from "./components/markdown-theme.ts";
import type mouseRegionTypes from "./components/mouse-region.types.ts";

declare namespace tuiTypesPart1 {
  type Token = TokenSource;
  type AutocompleteItem = autocompleteTypesModule.AutocompleteItem;
  type AutocompleteProvider = autocompleteTypesModule.AutocompleteProvider;
  type AutocompleteSuggestions = autocompleteTypesModule.AutocompleteSuggestions;
  type SlashCommand = autocompleteTypesModule.SlashCommand;
  type Color = colorsTypes.Color;
  type ColorMixSpace = colorsTypes.ColorMixSpace;
  type IndexedColor = colorsTypes.IndexedColor;
  type OkhslChannels = colorsTypes.OkhslChannels;
  type OklchChannels = colorsTypes.OklchChannels;
  type OklchColorValue = colorsTypes.OklchColorValue;
  type RgbColorValue = colorsTypes.RgbColorValue;
  type TerminalColorMode = colorsTypes.TerminalColorMode;
  type TextAttributes = colorsTypes.TextAttributes;
  type TextStyle = colorsTypes.TextStyle;
  type EditorOptions = editorTypes.EditorOptions;
  type EditorTheme = editorTypes.EditorTheme;
  type ImageOptions = imageTypes.ImageOptions;
  type ImageTheme = imageTypes.ImageTheme;
  type ImageTranscoder = imageTypes.ImageTranscoder;
  type LoaderIndicatorOptions = loaderTypes.LoaderIndicatorOptions;
  type DefaultTextStyle = markdownThemeTypes.DefaultTextStyle;
  type MarkdownOptions = markdownThemeTypes.MarkdownOptions;
  type MarkdownTheme = markdownThemeTypes.MarkdownTheme;
  type MouseRegionHandler = mouseRegionTypes.MouseRegionHandler;
  type Editor = editorTypes.Editor;
  type Image = imageTypes.Image;
  type Loader = loaderTypes.Loader;
  type MouseRegion = mouseRegionTypes.MouseRegion;
}

export type { tuiTypesPart1 as default };
