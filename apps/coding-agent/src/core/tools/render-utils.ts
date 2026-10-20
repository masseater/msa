import { pathToFileURL } from "node:url";

import tui from "@msa/tui";
import { Effect, type Fiber, Function as Fn, Predicate, Schedule } from "effect";

import type themeTypes from "../../modes/interactive/theme/theme.types.ts";
import ansi from "../../utils/ansi.ts";
import paths from "../../utils/paths.ts";
import shell from "../../utils/shell.ts";
import type extensionsTypesTypes from "../extensions/types.types.ts";
import platform from "../platform/index.ts";

const { abbreviateHomePath, resolvePath } = paths;
const { sanitizeBinaryOutput } = shell;
const { stripAnsi } = ansi;
const { currentTimeMillis } = platform;

const { getCapabilities, getImageDimensions, hyperlink, imageFallback } = tui;

function shortenPath(path: unknown): string {
  if (typeof path !== "string") return "";
  return abbreviateHomePath(path);
}

const linkPath: {
  (rawPath: string, cwd: string): (styledText: string) => string;
  (styledText: string, rawPath: string, cwd: string): string;
} = Fn.dual(3, (styledText: string, rawPath: string, cwd: string): string => {
  if (!getCapabilities().hyperlinks) return styledText;
  const absolutePath = resolvePath(rawPath, cwd);
  return hyperlink(styledText, pathToFileURL(absolutePath).href);
});

function str(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Predicate.isNullish(value)) return "";
  return null;
}

function parseLineNumber(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim() !== "") value = Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const formatReadLineRange: {
  (limit: unknown): (offset: unknown) => string;
  (offset: unknown, limit: unknown): string;
} = Fn.dual(2, (offset: unknown, limit: unknown): string => {
  if (Predicate.isNullish(offset) && Predicate.isNullish(limit)) return "";
  const start = Predicate.isNullish(offset) ? 1 : parseLineNumber(offset);
  if (start === undefined) return "";
  if (Predicate.isNullish(limit)) return `:${start}`;
  const count = parseLineNumber(limit);
  if (count === undefined) return "";
  const end = start + count - 1;
  return `:${start}${end === 0 ? "" : `-${end}`}`;
});

function replaceTabs(text: string): string {
  return text.replace(/\t/gu, "   ");
}

function normalizeDisplayText(text: string): string {
  return text.replace(/\r/gu, "");
}

type TextOutputSource =
  | { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }
  | undefined;

const getTextOutput: {
  (showImages: boolean): (result: TextOutputSource) => string;
  (result: TextOutputSource, showImages: boolean): string;
} = Fn.dual(2, (result: TextOutputSource, showImages: boolean): string => {
  if (result === undefined) return "";

  const textBlocks = result.content.filter((c) => c.type === "text");
  const imageBlocks = result.content.filter((c) => c.type === "image");

  let output = textBlocks
    .map((c) => sanitizeBinaryOutput(stripAnsi(c.text || "")).replace(/\r/gu, ""))
    .join("\n");

  const caps = getCapabilities();
  if (imageBlocks.length > 0 && (caps.images === null || !showImages)) {
    const imageIndicators = imageBlocks
      .map((img) => {
        const mimeType = img.mimeType ?? "image/unknown";
        const dims =
          img.data !== undefined &&
          img.data !== "" &&
          img.mimeType !== undefined &&
          img.mimeType !== ""
            ? (getImageDimensions(img.data, img.mimeType) ?? undefined)
            : undefined;
        return imageFallback(mimeType, dims);
      })
      .join("\n");
    output = output === "" ? imageIndicators : `${output}\n${imageIndicators}`;
  }

  return output;
});

const COLLAPSED_ARGS_CHARS = 100;

const formatToolCallWithArgs: {
  (args: unknown, theme: themeTypes.Theme, expanded: boolean): (title: string) => string;
  (title: string, args: unknown, theme: themeTypes.Theme, expanded: boolean): string;
} = Fn.dual(
  4,
  (title: string, args: unknown, theme: themeTypes.Theme, expanded: boolean): string => {
    const header = theme.fg("toolTitle", theme.bold(title));
    if (Predicate.isNullish(args)) return header;
    const entries =
      typeof args === "object" && !Array.isArray(args)
        ? Object.entries(args)
        : ([["args", args]] as [string, unknown][]);
    if (entries.length === 0) return header;
    if (expanded) {
      const lines = entries.map(([key, value]) => {
        const text =
          typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
        return `  ${key}: ${replaceTabs(text).replace(/\r/gu, "").split("\n").join("\n    ")}`;
      });
      return `${header}\n${theme.fg("muted", lines.join("\n"))}`;
    }
    const pairs = entries
      .map(([key, value]) => `${key}=${JSON.stringify(value) ?? String(value)}`)
      .join(" ");
    const preview =
      pairs.length > COLLAPSED_ARGS_CHARS
        ? `${pairs.slice(0, COLLAPSED_ARGS_CHARS - 3)}...`
        : pairs;
    return `${header} ${theme.fg("muted", preview)}`;
  },
);

function formatToolDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

interface ToolTimerState {
  startedAt?: number;
  endedAt?: number | undefined;
  interval?: Fiber.Fiber<never> | undefined;
}

function startToolTimer(context: extensionsTypesTypes.ToolRenderContext<ToolTimerState>): void {
  const state = context.state;
  if (context.executionStarted && state.startedAt === undefined) {
    state.startedAt = currentTimeMillis();
    state.endedAt = undefined;
  }
}

const startTicker = (
  context: extensionsTypesTypes.ToolRenderContext<ToolTimerState>,
): Fiber.Fiber<never> =>
  Effect.runFork(
    Effect.sync(() => context.invalidate()).pipe(
      Effect.delay(1000),
      Effect.repeat(Schedule.fixed(1000)),
      Effect.andThen(Effect.never),
    ),
  );

const toolTimerText: {
  (
    isPartial: boolean,
  ): (context: extensionsTypesTypes.ToolRenderContext<ToolTimerState>) => string | undefined;
  (
    context: extensionsTypesTypes.ToolRenderContext<ToolTimerState>,
    isPartial: boolean,
  ): string | undefined;
} = Fn.dual(
  2,
  (
    context: extensionsTypesTypes.ToolRenderContext<ToolTimerState>,
    isPartial: boolean,
  ): string | undefined => {
    const state = context.state;
    if (state.startedAt !== undefined && isPartial && state.interval === undefined) {
      state.interval = startTicker(context);
    }
    if (!isPartial || context.isError) {
      state.endedAt ??= currentTimeMillis();
      if (state.interval !== undefined) {
        state.interval.interruptUnsafe();
        state.interval = undefined;
      }
    }
    if (!isPartial && context.durationMs !== undefined)
      return `Took ${formatToolDuration(context.durationMs)}`;
    if (state.startedAt === undefined) return undefined;
    const endTime = state.endedAt ?? currentTimeMillis();
    return `${isPartial ? "Elapsed" : "Took"} ${formatToolDuration(endTime - state.startedAt)}`;
  },
);

function invalidArgText(theme: themeTypes.Theme): string {
  return theme.fg("error", "[invalid arg]");
}

interface RenderToolPathOptions {
  emptyFallback?: string;
}

const renderToolPath: {
  (
    theme: themeTypes.Theme,
    cwd: string,
    options?: RenderToolPathOptions,
  ): (rawPath: string | null) => string;
  (
    rawPath: string | null,
    theme: themeTypes.Theme,
    cwd: string,
    options?: RenderToolPathOptions,
  ): string;
} = Fn.dual(
  (args) => typeof args[1] !== "string",
  (
    rawPath: string | null,
    theme: themeTypes.Theme,
    cwd: string,
    options?: RenderToolPathOptions,
  ): string => {
    if (rawPath === null) return invalidArgText(theme);
    const value = rawPath === "" ? options?.emptyFallback : rawPath;
    if (value === undefined || value === "") return theme.fg("toolOutput", "...");
    return linkPath(theme.fg("accent", shortenPath(value)), value, cwd);
  },
);

const renderUtils = {
  formatReadLineRange,
  formatToolCallWithArgs,
  formatToolDuration,
  getTextOutput,
  invalidArgText,
  linkPath,
  normalizeDisplayText,
  renderToolPath,
  replaceTabs,
  shortenPath,
  startToolTimer,
  str,
  toolTimerText,
};

export default renderUtils;
