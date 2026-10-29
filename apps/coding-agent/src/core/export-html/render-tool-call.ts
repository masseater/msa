import type aiTypes from "@msa/ai/index.types";

import htmlModule from "../../utils/html.ts";
import renderUtils from "../tools/render-utils.ts";
import entryText from "./entry-text.ts";
import type exportTypesTypes from "./export-types.ts";
import renderOutput from "./render-output.ts";
import type sessionViewTypes from "./session-view.types.ts";

const { escapeXml } = htmlModule;
const { shortenHomePath, textOf } = entryText;
const { formatReadLineRange: readLineRange } = renderUtils;
const { formatOutput, images, imagesOf, languageOf, untab } = renderOutput;

type Args = aiTypes.ToolCall["arguments"];

type Result = sessionViewTypes.ToolResult | undefined;

const INVALID_ARG = '<span class="tool-error">[invalid arg]</span>';

const stringArg = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  return value === undefined || value === null ? "" : undefined;
};

const resultText = (result: Result, separator = "\n"): string =>
  result === undefined ? "" : textOf(result.content, separator);

const header = (name: string, pathHtml: string, extra = ""): string =>
  `<div class="tool-header"><span class="tool-name">${escapeXml(name)}</span> <span class="tool-path">${pathHtml}</span>${extra}</div>`;

const pathHtmlOf = (path: string | undefined, fallback = ""): string =>
  path === undefined ? INVALID_ARG : escapeXml(shortenHomePath(path === "" ? fallback : path));

const trimmedOutput = (result: Result, maxLines: number): string => {
  const output = resultText(result).trim();
  return output === "" ? "" : formatOutput(output, maxLines);
};

const renderBash = (args: Args, result: Result): string => {
  const command = stringArg(args["command"]);
  const shown = command === undefined ? INVALID_ARG : escapeXml(command === "" ? "..." : command);
  return `<div class="tool-command">$ ${shown}</div>${trimmedOutput(result, 5)}`;
};

const renderRead = (args: Args, result: Result): string => {
  const path = stringArg(args["file_path"] ?? args["path"]);
  const range = readLineRange(args["offset"], args["limit"]);
  const lines =
    path !== undefined && range !== ""
      ? `<span class="line-numbers">${escapeXml(range)}</span>`
      : "";
  const output = resultText(result);
  const body =
    result === undefined
      ? ""
      : `${images(imagesOf(result.content), "tool-images", "tool-image")}${output === "" ? "" : formatOutput(output, 10, path === undefined ? undefined : languageOf(path))}`;
  return `${header("read", pathHtmlOf(path) + lines)}${body}`;
};

const renderWrite = (args: Args, result: Result): string => {
  const path = stringArg(args["file_path"] ?? args["path"]);
  const content = stringArg(args["content"]);
  const lineCount = content?.split("\n").length ?? 0;
  const count = lineCount > 10 ? ` <span class="line-count">(${lineCount} lines)</span>` : "";
  const body =
    content === undefined
      ? '<div class="tool-error">[invalid content arg - expected string]</div>'
      : content === ""
        ? ""
        : formatOutput(content, 10, path === undefined ? undefined : languageOf(path));
  const output = resultText(result).trim();
  const tail =
    output === "" ? "" : `<div class="tool-output"><div>${escapeXml(output)}</div></div>`;
  return `${header("write", pathHtmlOf(path), count)}${body}${tail}`;
};

const diffLine = (line: string): string => {
  const kind = line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : "context";
  return `<div class="diff-${kind}">${escapeXml(untab(line))}</div>`;
};

const diffOf = (result: Result): string | undefined => {
  const details: unknown = result?.details;
  if (typeof details !== "object" || details === null || !("diff" in details)) return undefined;
  return typeof details.diff === "string" && details.diff !== "" ? details.diff : undefined;
};

const renderEdit = (args: Args, result: Result): string => {
  const path = stringArg(args["file_path"] ?? args["path"]);
  const diff = diffOf(result);
  const output = resultText(result).trim();
  const body =
    diff === undefined
      ? output === ""
        ? ""
        : `<div class="tool-output"><pre>${escapeXml(output)}</pre></div>`
      : `<div class="tool-diff">${diff.split("\n").map(diffLine).join("")}</div>`;
  return `${header("edit", pathHtmlOf(path))}${body}`;
};

const renderLs = (args: Args, result: Result): string => {
  const path = stringArg(args["path"]);
  const limit = args["limit"];
  const extra =
    limit === undefined
      ? ""
      : ` <span class="line-count">(limit ${escapeXml(String(limit))})</span>`;
  return `${header("ls", pathHtmlOf(path, ".") + extra)}${trimmedOutput(result, 20)}`;
};

const BUILTIN: ReadonlyMap<string, (args: Args, result: Result) => string> = new Map([
  ["bash", renderBash],
  ["edit", renderEdit],
  ["ls", renderLs],
  ["read", renderRead],
  ["write", renderWrite],
]);

const renderedResult = (rendered: exportTypesTypes.RenderedToolHtml, result: Result): string => {
  const { resultHtmlCollapsed: collapsed, resultHtmlExpanded: expanded } = rendered;
  if (
    collapsed !== undefined &&
    collapsed !== "" &&
    expanded !== undefined &&
    expanded !== "" &&
    collapsed !== expanded
  ) {
    return `<details class="tool-output expandable follows-tools ansi-rendered"><summary><div class="output-preview">${collapsed}</div><div class="expand-hint"></div></summary><div class="output-full">${expanded}</div></details>`;
  }
  if (expanded !== undefined && expanded !== "") {
    return `<div class="tool-output ansi-rendered">${expanded}</div>`;
  }
  const output = resultText(result);
  return output === "" ? "" : formatOutput(output, 10);
};

const renderCustom = (
  call: aiTypes.ToolCall,
  result: Result,
  rendered: exportTypesTypes.RenderedToolHtml | undefined,
): string => {
  const nameHeader = `<div class="tool-header"><span class="tool-name">${escapeXml(call.name)}</span></div>`;
  if (
    rendered === undefined ||
    Object.values(rendered).every((html) => html === undefined || html === "")
  ) {
    const output = resultText(result);
    const args = `<div class="tool-output"><pre>${escapeXml(JSON.stringify(call.arguments, null, 2))}</pre></div>`;
    return `${nameHeader}${args}${output === "" ? "" : formatOutput(output, 10)}`;
  }
  const callHeader =
    rendered.callHtml === undefined || rendered.callHtml === ""
      ? nameHeader
      : `<div class="tool-header ansi-rendered">${rendered.callHtml}</div>`;
  return `${callHeader}${renderedResult(rendered, result)}`;
};

const STATUS_ICONS: Readonly<Record<string, string>> = { error: "✗", ok: "✓", unfinished: "…" };

const nestedLine = (call: aiTypes.NestedToolCallRecord): string => {
  const args =
    call.arguments === undefined
      ? `[arguments omitted, ${call.argumentsBytes ?? 0} bytes]`
      : JSON.stringify(call.arguments);
  const duration = call.durationMs === undefined ? "" : ` ${call.durationMs}ms`;
  const error = call.error === undefined ? "" : `\n    ${call.error.split("\n").join("\n    ")}`;
  return `${STATUS_ICONS[call.status] ?? "?"} ${call.name} ${args}${duration}${error}`;
};

const renderNested = (result: Result): string => {
  const nested = result?.nestedCalls;
  if (nested === undefined || nested.calls.length === 0) return "";
  const title = `Nested calls: ${nested.calls.length}${nested.complete ? "" : " (incomplete record)"}`;
  return formatOutput([title, ...nested.calls.map(nestedLine)].join("\n"), 1);
};

const statusOf = (result: Result): string => {
  if (result === undefined) return "pending";
  return result.isError ? "error" : "success";
};

const renderToolCall = (
  call: aiTypes.ToolCall,
  result: Result,
  rendered: exportTypesTypes.RenderedToolHtml | undefined,
  anchor: string,
): string => {
  const builtin = BUILTIN.get(call.name);
  const body =
    builtin === undefined ? renderCustom(call, result, rendered) : builtin(call.arguments, result);
  return `<div class="tool-execution ${statusOf(result)}" id="tool-call-${escapeXml(call.id)}">${anchor}${body}${renderNested(result)}</div>`;
};

const renderToolCallModule = { renderToolCall };

export default renderToolCallModule;
