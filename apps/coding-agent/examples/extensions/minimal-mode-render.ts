import { homedir } from "os";

import type aiTypes from "@msa/ai/index.types";
import type { Theme } from "@msa/coding-agent";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  formatReadLineRange,
} from "@msa/coding-agent";
import tui from "@msa/tui";

const { Text } = tui;

const shortenPath = (path: string): string => {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
};

const textOf = (result: {
  content: ReadonlyArray<aiTypes.TextContent | aiTypes.ImageContent>;
}): string | undefined => {
  const found = result.content.find((c) => c.type === "text");
  return found?.type === "text" ? found.text : undefined;
};

const countLines = (text: string): number => text.trim().split("\n").filter(Boolean).length;

const expandedLines = (text: string, theme: Theme): string =>
  text
    .trim()
    .split("\n")
    .map((line) => theme.fg("toolOutput", line))
    .join("\n");

const listResult = (
  result: { content: ReadonlyArray<aiTypes.TextContent | aiTypes.ImageContent> },
  expanded: boolean,
  theme: Theme,
  unit: string,
) => {
  const text = textOf(result);
  if (text === undefined) return new Text("", 0, 0);

  if (!expanded) {
    const count = countLines(text);
    return count > 0
      ? new Text(theme.fg("muted", ` → ${count} ${unit}`), 0, 0)
      : new Text("", 0, 0);
  }

  return new Text(`\n${expandedLines(text, theme)}`, 0, 0);
};

const renderLsCall: NonNullable<ReturnType<typeof createLsToolDefinition>["renderCall"]> = (
  args,
  theme,
) => {
  const path = shortenPath(args.path || ".");
  const limit = args.limit;
  let text = `${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", path)}`;
  if (limit !== undefined) {
    text += theme.fg("toolOutput", ` (limit ${limit})`);
  }
  return new Text(text, 0, 0);
};

const renderLsResult: NonNullable<ReturnType<typeof createLsToolDefinition>["renderResult"]> = (
  result,
  { expanded },
  theme,
) => listResult(result, expanded, theme, "entries");

const renderGrepCall: NonNullable<ReturnType<typeof createGrepToolDefinition>["renderCall"]> = (
  args,
  theme,
) => {
  const pattern = args.pattern || "";
  const path = shortenPath(args.path || ".");
  const glob = args.glob;
  const limit = args.limit;

  let text = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${pattern}/`)}`;
  text += theme.fg("toolOutput", ` in ${path}`);
  if (glob !== undefined && glob.length > 0) {
    text += theme.fg("toolOutput", ` (${glob})`);
  }
  if (limit !== undefined) {
    text += theme.fg("toolOutput", ` limit ${limit}`);
  }
  return new Text(text, 0, 0);
};

const renderGrepResult: NonNullable<ReturnType<typeof createGrepToolDefinition>["renderResult"]> = (
  result,
  { expanded },
  theme,
) => listResult(result, expanded, theme, "matches");

const renderFindCall: NonNullable<ReturnType<typeof createFindToolDefinition>["renderCall"]> = (
  args,
  theme,
) => {
  const pattern = args.pattern || "";
  const path = shortenPath(args.path || ".");
  const limit = args.limit;

  let text = `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", pattern)}`;
  text += theme.fg("toolOutput", ` in ${path}`);
  if (limit !== undefined) {
    text += theme.fg("toolOutput", ` (limit ${limit})`);
  }
  return new Text(text, 0, 0);
};

const renderFindResult: NonNullable<ReturnType<typeof createFindToolDefinition>["renderResult"]> = (
  result,
  { expanded },
  theme,
) => listResult(result, expanded, theme, "files");

const pathDisplay = (rawPath: string, theme: Theme): string => {
  const path = shortenPath(rawPath);
  return path.length > 0 ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
};

const renderReadCall: NonNullable<ReturnType<typeof createReadToolDefinition>["renderCall"]> = (
  args,
  theme,
) => {
  const lineRange = formatReadLineRange(args.offset, args.limit);
  const suffix = lineRange.length > 0 ? theme.fg("warning", lineRange) : "";
  return new Text(
    `${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay(args.path, theme)}${suffix}`,
    0,
    0,
  );
};

const renderReadResult: NonNullable<ReturnType<typeof createReadToolDefinition>["renderResult"]> = (
  result,
  { expanded },
  theme,
) => {
  const text = textOf(result);
  if (!expanded || text === undefined) return new Text("", 0, 0);
  return new Text(`\n${expandedLines(text, theme)}`, 0, 0);
};

const renderBashCall: NonNullable<ReturnType<typeof createBashToolDefinition>["renderCall"]> = (
  args,
  theme,
) => {
  const command = args.command || "...";
  const timeout = args.timeout;
  const suffix = timeout === undefined ? "" : theme.fg("muted", ` (timeout ${timeout}s)`);
  return new Text(theme.fg("toolTitle", theme.bold(`$ ${command}`)) + suffix, 0, 0);
};

const renderBashResult: NonNullable<ReturnType<typeof createBashToolDefinition>["renderResult"]> = (
  result,
  { expanded },
  theme,
) => {
  const text = textOf(result);
  if (!expanded || text === undefined) return new Text("", 0, 0);
  const output = expandedLines(text, theme);
  return output.length === 0 ? new Text("", 0, 0) : new Text(`\n${output}`, 0, 0);
};

const renderEditCall: NonNullable<ReturnType<typeof createEditToolDefinition>["renderCall"]> = (
  args,
  theme,
) =>
  new Text(`${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay(args.path, theme)}`, 0, 0);

const renderEditResult: NonNullable<ReturnType<typeof createEditToolDefinition>["renderResult"]> = (
  result,
  { expanded },
  theme,
) => {
  const text = textOf(result);
  if (!expanded || text === undefined) return new Text("", 0, 0);
  const failed = text.includes("Error") || text.includes("error");
  return new Text(`\n${theme.fg(failed ? "error" : "toolOutput", text)}`, 0, 0);
};

const renderWriteCall: NonNullable<ReturnType<typeof createWriteToolDefinition>["renderCall"]> = (
  args,
  theme,
) => {
  const lines = args.content.length > 0 ? args.content.split("\n").length : 0;
  const lineInfo = lines > 0 ? theme.fg("muted", ` (${lines} lines)`) : "";
  return new Text(
    `${theme.fg("toolTitle", theme.bold("write"))} ${pathDisplay(args.path, theme)}${lineInfo}`,
    0,
    0,
  );
};

const renderWriteResult: NonNullable<
  ReturnType<typeof createWriteToolDefinition>["renderResult"]
> = (result, { expanded }, theme) => {
  const text = textOf(result);
  if (!expanded || text === undefined || text.length === 0) return new Text("", 0, 0);
  return new Text(`\n${theme.fg("error", text)}`, 0, 0);
};

export const toolRenderers = {
  bash: { renderCall: renderBashCall, renderResult: renderBashResult },
  edit: { renderCall: renderEditCall, renderResult: renderEditResult },
  find: { renderCall: renderFindCall, renderResult: renderFindResult },
  grep: { renderCall: renderGrepCall, renderResult: renderGrepResult },
  ls: { renderCall: renderLsCall, renderResult: renderLsResult },
  read: { renderCall: renderReadCall, renderResult: renderReadResult },
  write: { renderCall: renderWriteCall, renderResult: renderWriteResult },
};
