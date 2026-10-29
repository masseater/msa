import type aiTypes from "@msa/ai/index.types";

import htmlModule from "../../utils/html.ts";
import type exportTypesTypes from "./export-types.ts";
import type sessionViewTypes from "./session-view.types.ts";

const { escapeXml } = htmlModule;

type Entry = sessionViewTypes.Entry;

interface Totals {
  readonly cost: number;
  readonly counts: readonly number[];
  readonly models: readonly string[];
  readonly tokens: readonly [input: number, output: number, cacheRead: number, cacheWrite: number];
  readonly toolCalls: number;
}

const COUNTED: readonly (readonly [kind: string, label: string])[] = [
  ["user", "user"],
  ["assistant", "assistant"],
  ["toolResult", "tool results"],
  ["custom_message", "custom"],
  ["compaction", "compactions"],
  ["branch_summary", "branch summaries"],
];

const kindOf = (entry: Entry): string =>
  entry.type === "message" ? entry.message.role : entry.type;

const assistants = (entries: readonly Entry[]): readonly aiTypes.AssistantMessage[] =>
  entries.flatMap((entry) =>
    entry.type === "message" && entry.message.role === "assistant" ? [entry.message] : [],
  );

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

const totalsOf = (entries: readonly Entry[]): Totals => {
  const messages = assistants(entries);
  const usage = messages.map((message) => message.usage);
  const counts = COUNTED.map(([kind]) => entries.filter((entry) => kindOf(entry) === kind).length);
  return {
    cost: sum(usage.map(({ cost }) => cost.input + cost.output + cost.cacheRead + cost.cacheWrite)),
    counts,
    models: [
      ...new Set(
        messages.map(({ model, provider }) => (provider === "" ? model : `${provider}/${model}`)),
      ),
    ],
    tokens: [
      sum(usage.map(({ input }) => input)),
      sum(usage.map(({ output }) => output)),
      sum(usage.map(({ cacheRead }) => cacheRead)),
      sum(usage.map(({ cacheWrite }) => cacheWrite)),
    ],
    toolCalls: sum(
      messages.map(({ content }) => content.filter(({ type }) => type === "toolCall").length),
    ),
  };
};

const formatTokens = (count: number): string => {
  if (count < 1000) return count.toString();
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
};

const TOKEN_MARKS = ["↑", "↓", "R", "W"] as const;

const tokenText = (tokens: Totals["tokens"]): string =>
  tokens
    .flatMap((count, index) => (count === 0 ? [] : [`${TOKEN_MARKS[index]}${formatTokens(count)}`]))
    .join(" ");

const messageText = (counts: Totals["counts"]): string =>
  COUNTED.flatMap(([, label], index) => {
    const count = counts.at(index) ?? 0;
    return count === 0 ? [] : [`${count} ${label}`];
  }).join(", ");

const infoItem = (label: string, value: string): string =>
  `<div class="info-item"><span class="info-label">${label}:</span><span class="info-value">${escapeXml(value)}</span></div>`;

const toggle = (id: string, key: string, label: string, checked: boolean): string =>
  `<label class="header-toggle-btn" title="Access key ${key.toUpperCase()}"><input type="checkbox" class="visually-hidden" id="${id}" accesskey="${key}"${checked ? " checked" : ""}>${label}</label>`;

const actions = (headerId: string, jsonl: string): string =>
  [
    toggle("toggle-thinking", "t", "Toggle thinking", true),
    toggle("toggle-tools", "o", "Toggle tools", false),
    toggle(
      "toggle-hidden",
      "h",
      '<span class="when-off">Show hidden messages</span><span class="when-on">Hide hidden messages</span>',
      false,
    ),
    `<a class="download-json-btn" download="${escapeXml(headerId)}.jsonl" href="data:application/x-ndjson;base64,${jsonl}" title="Download session as JSONL">↓ JSONL</a>`,
  ].join("");

const systemPromptHtml = (prompt: string | undefined): string => {
  if (prompt === undefined || prompt === "") return "";
  const lines = prompt.split("\n");
  if (lines.length <= 10) {
    return `<div class="system-prompt"><div class="system-prompt-header">System Prompt</div><div class="system-prompt-full">${escapeXml(prompt)}</div></div>`;
  }
  return `<details class="system-prompt expandable"><summary><div class="system-prompt-header">System Prompt</div><div class="system-prompt-preview">${escapeXml(lines.slice(0, 10).join("\n"))}</div><div class="system-prompt-expand-hint">... (${lines.length - 10} more lines, click to expand)</div></summary><div class="system-prompt-full">${escapeXml(prompt)}</div></details>`;
};

interface ParameterSchema {
  readonly description?: unknown;
  readonly type?: unknown;
}

const parameterHtml = (name: string, schema: ParameterSchema, required: boolean): string => {
  const description =
    typeof schema.description === "string"
      ? `<div class="tool-param-desc">${escapeXml(schema.description)}</div>`
      : "";
  const flag = required
    ? '<span class="tool-param-required">required</span>'
    : '<span class="tool-param-optional">optional</span>';
  return `<div class="tool-param"><span class="tool-param-name">${escapeXml(name)}</span> <span class="tool-param-type">${escapeXml(typeof schema.type === "string" ? schema.type : "any")}</span> ${flag}${description}</div>`;
};

const parametersOf = (parameters: unknown): readonly string[] => {
  if (typeof parameters !== "object" || parameters === null || !("properties" in parameters))
    return [];
  const { properties } = parameters;
  if (typeof properties !== "object" || properties === null) return [];
  const required =
    "required" in parameters && Array.isArray(parameters.required) ? parameters.required : [];
  return Object.entries(properties).map(([name, schema]: [string, ParameterSchema]) =>
    parameterHtml(name, schema, required.includes(name)),
  );
};

const toolHtml = (tool: NonNullable<exportTypesTypes.SessionData["tools"]>[number]): string => {
  const title = `<span class="tool-item-name">${escapeXml(tool.name)}</span> - <span class="tool-item-desc">${escapeXml(tool.description)}</span>`;
  const params = parametersOf(tool.parameters);
  return params.length === 0
    ? `<div class="tool-item">${title}</div>`
    : `<details class="tool-item"><summary>${title} <span class="tool-params-hint"></span></summary><div class="tool-params-content">${params.join("")}</div></details>`;
};

const toolsHtml = (tools: exportTypesTypes.SessionData["tools"]): string =>
  tools === undefined || tools.length === 0
    ? ""
    : `<div class="tools-list"><div class="tools-header">Available Tools</div><div class="tools-content">${tools.map(toolHtml).join("")}</div></div>`;

const renderHeader = (
  sessionData: exportTypesTypes.SessionData,
  sessionTime: string | undefined,
  jsonl: string,
): string => {
  const totals = totalsOf(sessionData.entries);
  const id = sessionData.header?.id ?? "unknown";
  const info = [
    infoItem("Date", sessionTime ?? "unknown"),
    infoItem("Models", totals.models.join(", ") || "unknown"),
    infoItem("Messages", messageText(totals.counts) || "0"),
    infoItem("Tool Calls", String(totals.toolCalls)),
    infoItem("Tokens", tokenText(totals.tokens) || "0"),
    infoItem("Cost", `$${totals.cost.toFixed(3)}`),
  ].join("");
  return `<div class="header"><h1><a class="session-link" href="#">Session: ${escapeXml(id)}</a></h1><div class="help-bar"><span class="help-hint">Access keys: T thinking · O tools · H hidden messages</span><div class="help-actions">${actions(sessionData.header?.id ?? "session", jsonl)}</div></div><div class="header-info">${info}</div></div>${systemPromptHtml(sessionData.systemPrompt)}${toolsHtml(sessionData.tools)}`;
};

const renderHeaderModule = { renderHeader };

export default renderHeaderModule;
