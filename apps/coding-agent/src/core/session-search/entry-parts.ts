import { Predicate } from "effect";

import type sessionSearchTypes from "./session-search.types.ts";

type Part = sessionSearchTypes.Part;

function blockTexts(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => Predicate.isObject(block) && block["type"] === "text")
    .map((block) => String((block as Record<string, unknown>)["text"] ?? ""))
    .join("\n");
}

function valueLines(value: unknown, label: string): string[] {
  const prefix = label === "" ? "" : `${label}: `;
  if (typeof value === "string") return [`${prefix}${value}`];
  if (Array.isArray(value)) return value.flatMap((item) => valueLines(item, label));
  if (Predicate.isObject(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      valueLines(item, label === "" ? key : `${label}.${key}`),
    );
  }
  return [`${prefix}${String(value)}`];
}

function assistantParts(content: unknown): Part[] {
  if (!Array.isArray(content)) return [];
  const parts: Part[] = [];
  const text = blockTexts(content);
  if (text.trim() !== "") parts.push({ kind: "assistant", text, tool: null });
  for (const block of content) {
    if (!Predicate.isObject(block) || block["type"] !== "toolCall") continue;
    parts.push({
      kind: "tool_call",
      text: valueLines(block["arguments"] ?? {}, "").join("\n"),
      tool: typeof block["name"] === "string" ? block["name"] : null,
    });
  }
  return parts;
}

function messageParts(message: Record<string, unknown>): Part[] {
  const role = message["role"];
  if (role === "user") {
    const text = blockTexts(message["content"]);
    return text.trim() === "" ? [] : [{ kind: "user", text, tool: null }];
  }
  if (role === "assistant") return assistantParts(message["content"]);
  if (role === "toolResult") {
    const tool = message["toolName"];
    return [
      {
        kind: "tool_result",
        text: blockTexts(message["content"]),
        tool: typeof tool === "string" ? tool : null,
      },
    ];
  }
  return [];
}

function entryParts(entry: unknown): Part[] {
  if (!Predicate.isObject(entry) || entry["type"] !== "message") return [];
  const message = entry["message"];
  return Predicate.isObject(message) ? messageParts(message) : [];
}

const entryPartsModule = { entryParts };

export default entryPartsModule;
