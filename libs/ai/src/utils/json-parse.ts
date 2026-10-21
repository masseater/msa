import { parse as partialParse } from "partial-json";

import type typesModule from "../types.types.ts";

const VALID_JSON_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);

function isControlCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x00 && codePoint <= 0x1f;
}

function escapeControlCharacter(char: string): string {
  switch (char) {
    case "\b":
      return "\\b";
    case "\f":
      return "\\f";
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
    default:
      return `\\u${char.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`;
  }
}

const repairEscape = (json: string, index: number): { text: string; skip: number } => {
  const nextChar = json[index + 1];
  if (nextChar === undefined) return { skip: 0, text: "\\\\" };

  if (nextChar === "u") {
    const unicodeDigits = json.slice(index + 2, index + 6);
    if (/^[0-9a-fA-F]{4}$/u.test(unicodeDigits)) return { skip: 5, text: `\\u${unicodeDigits}` };
  }

  if (VALID_JSON_ESCAPES.has(nextChar)) return { skip: 1, text: `\\${nextChar}` };

  return { skip: 0, text: "\\\\" };
};

const repairJson = (json: string): string => {
  let repaired = "";
  let inString = false;

  for (let index = 0; index < json.length; index++) {
    const char = json.charAt(index);

    if (!inString) {
      repaired += char;
      if (char === '"') {
        inString = true;
      }
      continue;
    }

    if (char === '"') {
      repaired += char;
      inString = false;
      continue;
    }

    if (char === "\\") {
      const escape = repairEscape(json, index);
      repaired += escape.text;
      index += escape.skip;
      continue;
    }

    repaired += isControlCharacter(char) ? escapeControlCharacter(char) : char;
  }

  return repaired;
};

function parseJsonWithRepair<T>(json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    const repairedJson = repairJson(json);
    if (repairedJson !== json) {
      return JSON.parse(repairedJson) as T;
    }
    throw error;
  }
}

function parseToolCallArguments(
  json: string | undefined,
): Pick<typesModule.ToolCall, "arguments" | "argumentsError"> {
  if (json === undefined || json.trim() === "") return { arguments: {} };
  try {
    const parsed = parseJsonWithRepair<typesModule.ToolCall["arguments"] | null>(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Tool arguments must be a JSON object");
    }
    return { arguments: parsed };
  } catch (error) {
    return {
      arguments: {},
      argumentsError: `${error instanceof Error ? error.message : String(error)}\n\nReceived arguments:\n${json}`,
    };
  }
}

function parseStreamingJson<T = Record<string, unknown>>(partialJson: string | undefined): T {
  if (partialJson === undefined || partialJson === "" || partialJson.trim() === "") {
    return {} as T;
  }

  try {
    return parseJsonWithRepair<T>(partialJson);
  } catch {
    try {
      const result = partialParse(partialJson);
      return (result ?? {}) as T;
    } catch {
      try {
        const result = partialParse(repairJson(partialJson));
        return (result ?? {}) as T;
      } catch {
        return {} as T;
      }
    }
  }
}

const jsonParse = {
  parseJsonWithRepair,
  parseStreamingJson,
  parseToolCallArguments,
  repairJson,
};

export default jsonParse;
