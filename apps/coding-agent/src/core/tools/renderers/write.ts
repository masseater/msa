import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import keybindingHints from "../../../modes/interactive/components/keybinding-hints.ts";
import themeModule from "../../../modes/interactive/theme/theme.ts";
import type themeTypes from "../../../modes/interactive/theme/theme.types.ts";
import type extensionsTypesTypes from "../../extensions/types.types.ts";
import renderUtils from "../render-utils.ts";

const { getLanguageFromPath, highlightCode } = themeModule;
const { normalizeDisplayText, renderToolPath, replaceTabs, str } = renderUtils;
const { expandHint } = keybindingHints;

const { Container, Text } = tui;

type WriteHighlightCache = {
  rawPath: string | null;
  lang: string;
  rawContent: string;
  normalizedLines: string[];
  highlightedLines: string[];
};
class WriteCallRenderComponent extends tui.Text {
  cache?: WriteHighlightCache | undefined;

  constructor() {
    super("", 0, 0);
  }
}
const WRITE_PARTIAL_FULL_HIGHLIGHT_LINES = 50;
function highlightSingleLine(line: string, lang: string): string {
  const highlighted = highlightCode(line, lang);
  return highlighted[0] ?? "";
}
function refreshWriteHighlightPrefix(cache: WriteHighlightCache): void {
  const prefixCount = Math.min(WRITE_PARTIAL_FULL_HIGHLIGHT_LINES, cache.normalizedLines.length);
  if (prefixCount === 0) return;
  const prefixSource = cache.normalizedLines.slice(0, prefixCount).join("\n");
  const prefixHighlighted = highlightCode(prefixSource, cache.lang);
  for (let i = 0; i < prefixCount; i++) {
    cache.highlightedLines[i] =
      prefixHighlighted[i] ?? highlightSingleLine(cache.normalizedLines[i] ?? "", cache.lang);
  }
}
function rebuildWriteHighlightCacheFull(
  rawPath: string | null,
  fileContent: string,
): WriteHighlightCache | undefined {
  const lang = rawPath !== null && rawPath !== "" ? getLanguageFromPath(rawPath) : undefined;
  if (lang === undefined || lang === "") return undefined;
  const displayContent = normalizeDisplayText(fileContent);
  const normalized = replaceTabs(displayContent);
  return {
    highlightedLines: highlightCode(normalized, lang),
    lang,
    normalizedLines: normalized.split("\n"),
    rawContent: fileContent,
    rawPath,
  };
}
function updateWriteHighlightCacheIncremental(
  cache: WriteHighlightCache | undefined,
  rawPath: string | null,
  fileContent: string,
): WriteHighlightCache | undefined {
  const lang = rawPath !== null && rawPath !== "" ? getLanguageFromPath(rawPath) : undefined;
  if (lang === undefined || lang === "") return undefined;
  if (cache === undefined) return rebuildWriteHighlightCacheFull(rawPath, fileContent);
  if (cache.lang !== lang || cache.rawPath !== rawPath)
    return rebuildWriteHighlightCacheFull(rawPath, fileContent);
  if (!fileContent.startsWith(cache.rawContent))
    return rebuildWriteHighlightCacheFull(rawPath, fileContent);
  if (fileContent.length === cache.rawContent.length) return cache;

  const deltaRaw = fileContent.slice(cache.rawContent.length);
  const deltaDisplay = normalizeDisplayText(deltaRaw);
  const deltaNormalized = replaceTabs(deltaDisplay);
  cache.rawContent = fileContent;
  if (cache.normalizedLines.length === 0) {
    cache.normalizedLines.push("");
    cache.highlightedLines.push("");
  }

  const [firstSegment, ...moreSegments] = deltaNormalized.split("\n");
  const lastIndex = cache.normalizedLines.length - 1;
  const lastLine = (cache.normalizedLines[lastIndex] ?? "") + (firstSegment ?? "");
  cache.normalizedLines[lastIndex] = lastLine;
  cache.highlightedLines[lastIndex] = highlightSingleLine(lastLine, cache.lang);
  for (const segment of moreSegments) {
    cache.normalizedLines.push(segment);
    cache.highlightedLines.push(highlightSingleLine(segment, cache.lang));
  }
  refreshWriteHighlightPrefix(cache);
  return cache;
}
function trimTrailingEmptyLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end--;
  }
  return lines.slice(0, end);
}
function formatWriteCall(
  args: { path?: string; file_path?: string; content?: string } | undefined,
  options: extensionsTypesTypes.ToolRenderResultOptions,
  theme: themeTypes.Theme,
  cache: WriteHighlightCache | undefined,
  cwd: string,
): string {
  const rawPath = str(args?.file_path ?? args?.path);
  const fileContent = str(args?.content);
  const pathDisplay = renderToolPath(rawPath, theme, cwd);
  let text = `${theme.fg("toolTitle", theme.bold("write"))} ${pathDisplay}`;

  if (fileContent === null) {
    text += `\n\n${theme.fg("error", "[invalid content arg - expected string]")}`;
  } else if (fileContent !== "") {
    const lang = rawPath !== null && rawPath !== "" ? getLanguageFromPath(rawPath) : undefined;
    const renderedLines =
      lang !== undefined && lang !== ""
        ? (cache?.highlightedLines ??
          highlightCode(replaceTabs(normalizeDisplayText(fileContent)), lang))
        : normalizeDisplayText(fileContent).split("\n");
    const lines = trimTrailingEmptyLines(renderedLines);
    const count = normalizeDisplayText(fileContent).replace(/\n+$/u, "").split("\n").length;
    text += options.expanded
      ? `\n\n${lines.map((line) => (lang !== undefined && lang !== "" ? line : theme.fg("toolOutput", replaceTabs(line)))).join("\n")}`
      : `\n${expandHint(`${count} ${count === 1 ? "line" : "lines"}`)}`;
  }

  return text;
}
function formatWriteResult(
  result: {
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
  },
  theme: themeTypes.Theme,
): string | undefined {
  if (result.isError !== true) {
    return undefined;
  }
  const output = result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("\n");
  if (output === "") {
    return undefined;
  }
  return `\n${theme.fg("error", output)}`;
}

const writeRenderers: Pick<
  extensionsTypesTypes.ToolDefinition<any, any>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, context) {
    const renderArgs = args as { path?: string; file_path?: string; content?: string } | undefined;
    const rawPath = str(renderArgs?.file_path ?? renderArgs?.path);
    const fileContent = str(renderArgs?.content);
    const component =
      (context.lastComponent as WriteCallRenderComponent | undefined) ??
      new WriteCallRenderComponent();
    if (fileContent === null) {
      component.cache = undefined;
    } else {
      component.cache = context.argsComplete
        ? rebuildWriteHighlightCacheFull(rawPath, fileContent)
        : updateWriteHighlightCacheIncremental(component.cache, rawPath, fileContent);
    }
    component.setText(
      formatWriteCall(
        renderArgs,
        { expanded: context.expanded, isPartial: context.isPartial },
        theme,
        component.cache,
        context.cwd,
      ),
    );
    return component;
  },
  renderResult(result, _options, theme, context) {
    const output = formatWriteResult({ ...result, isError: context.isError }, theme);
    if (output === undefined || output === "") {
      const component =
        (context.lastComponent as tuiTypes.Container | undefined) ?? new Container();
      component.clear();
      return component;
    }
    const text = (context.lastComponent as tuiTypes.Text | undefined) ?? new Text("", 0, 0);
    text.setText(output);
    return text;
  },
};

const write = {
  writeRenderers,
};

export default write;
