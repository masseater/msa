import type { Token as TokenSource } from "marked";

import type imageTypes from "../components/image.types.ts";
import type markdownThemeTypes from "../components/markdown-theme.ts";
import type markdownTypes from "../components/markdown.types.ts";
import type textTypes from "../components/text.types.ts";
import type truncatedTextTypes from "../components/truncated-text.types.ts";

declare namespace tuiContentKitTypes {
  type Token = TokenSource;
  type ImageOptions = imageTypes.ImageOptions;
  type ImageTheme = imageTypes.ImageTheme;
  type ImageTranscoder = imageTypes.ImageTranscoder;
  type DefaultTextStyle = markdownThemeTypes.DefaultTextStyle;
  type MarkdownOptions = markdownThemeTypes.MarkdownOptions;
  type MarkdownTheme = markdownThemeTypes.MarkdownTheme;
  type Image = imageTypes.Image;
  type Markdown = markdownTypes.Markdown;
  type Text = textTypes.Text;
  type TruncatedText = truncatedTextTypes.TruncatedText;
}

export type { tuiContentKitTypes as default };
