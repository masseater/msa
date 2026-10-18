import { type Static, Type } from "typebox";

import type {
  ExtensionAPI,
  ToolDefinition,
  ToolExposure,
  ToolInfo,
  ToolNamespace,
} from "../../core/extensions/types.ts";

export const TOOL_SEARCH_TOOL_NAME = "tool_search";
export const DEFAULT_TOOL_SEARCH_LIMIT = 8;

export interface ToolSearchDocument {
  name: string;
  text: string;
}

export interface ToolSearchMatch {
  name: string;
  score: number;
}

export interface ToolRanker {
  rank(query: string, documents: readonly ToolSearchDocument[], limit: number): ToolSearchMatch[];
}

const STOP_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

function stem(term: string): string {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && /(ches|shes|sses|xes|zes)$/u.test(term)) return term.slice(0, -2);
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) return term.slice(0, -1);
  return term;
}

export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((term) => term.length > 0 && !STOP_WORDS.has(term))
    .map(stem);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaText(schema: unknown, parts: string[]): void {
  if (!isObject(schema)) return;
  if (typeof schema["description"] === "string") parts.push(schema["description"]);
  if (isObject(schema["properties"])) {
    for (const [name, property] of Object.entries(schema["properties"])) {
      parts.push(name);
      schemaText(property, parts);
    }
  }
  schemaText(schema["items"], parts);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const variants = schema[key];
    if (Array.isArray(variants)) for (const variant of variants) schemaText(variant, parts);
  }
}

export function createToolSearchDocument(
  tool: Pick<ToolInfo, "name" | "description" | "parameters">,
  namespace?: ToolNamespace,
): ToolSearchDocument {
  const parts = [tool.name, tool.name.replaceAll("_", " "), tool.description];
  schemaText(tool.parameters, parts);
  if (namespace !== undefined)
    parts.push(namespace.name, namespace.description ?? "", namespace.instructions ?? "");
  return { name: tool.name, text: parts.filter((part) => part.trim()).join(" ") };
}

export class Bm25Ranker implements ToolRanker {
  private readonly k1: number;
  private readonly b: number;

  constructor(options: { k1?: number; b?: number } = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
  }

  rank(query: string, documents: readonly ToolSearchDocument[], limit: number): ToolSearchMatch[] {
    const queryTerms = [...new Set(tokenize(query))];
    if (queryTerms.length === 0 || documents.length === 0 || limit <= 0) return [];
    const indexed = documents.map((document) => {
      const counts = new Map<string, number>();
      for (const term of tokenize(document.text)) counts.set(term, (counts.get(term) ?? 0) + 1);
      const length = [...counts.values()].reduce((sum, count) => sum + count, 0);
      return { document, counts, length };
    });
    const averageLength =
      indexed.reduce((sum, { length }) => sum + length, 0) / documents.length || 1;
    const idf = new Map(
      queryTerms.map((term) => {
        const frequency = indexed.filter(({ counts }) => counts.has(term)).length;
        return [
          term,
          Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5)),
        ] as const;
      }),
    );
    const matches: ToolSearchMatch[] = [];
    for (const { document, counts, length } of indexed) {
      let score = 0;
      for (const term of queryTerms) {
        const count = counts.get(term);
        if (count === undefined || count === 0) continue;
        const norm = this.k1 * (1 - this.b + (this.b * length) / averageLength);
        score += (idf.get(term) ?? 0) * ((count * (this.k1 + 1)) / (count + norm));
      }
      if (score > 0) matches.push({ name: document.name, score });
    }
    return matches.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

export const toolSearchSchema = Type.Object({
  query: Type.String({ description: "Search query for deferred tools." }),
  limit: Type.Optional(
    Type.Number({
      description: `Maximum number of tools to return. Defaults to ${DEFAULT_TOOL_SEARCH_LIMIT}.`,
    }),
  ),
});

export type ToolSearchInput = Static<typeof toolSearchSchema>;

export interface ToolSearchResultTool {
  name: string;
  description: string;
}

export interface ToolSearchToolDetails {
  loaded: string[];
}

export interface ToolSearchToolOptions {
  tools?: Pick<ExtensionAPI, "getAllTools" | "getActiveTools" | "setActiveTools">;
}

function isSearchable(exposure: ToolExposure): boolean {
  return exposure === "codemode" || exposure === "deferred";
}

function searchAndLoad(
  tools: NonNullable<ToolSearchToolOptions["tools"]>,
  query: string,
  limit: number,
): ToolSearchResultTool[] {
  const active = tools.getActiveTools();
  const candidates = tools
    .getAllTools()
    .filter((tool) => isSearchable(tool.exposure) && !active.includes(tool.name));
  const documents = candidates.map((tool) => createToolSearchDocument(tool, tool.namespace));
  const matches = new Bm25Ranker().rank(query, documents, limit);
  if (matches.length > 0) tools.setActiveTools([...active, ...matches.map((match) => match.name)]);
  return matches.map((match) => ({
    name: match.name,
    description: candidates.find((tool) => tool.name === match.name)?.description ?? "",
  }));
}

export const TOOL_SEARCH_DESCRIPTION = `# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.\n\nSome of the tools, such as tools of MCP servers, may not have been provided to you upfront, and you should use this tool (\`${TOOL_SEARCH_TOOL_NAME}\`) to search for the required tools. For MCP tool discovery, always use \`${TOOL_SEARCH_TOOL_NAME}\`.`;

export function createToolSearchToolDefinition(
  options: ToolSearchToolOptions = {},
): ToolDefinition<typeof toolSearchSchema, ToolSearchToolDetails> {
  return {
    name: TOOL_SEARCH_TOOL_NAME,
    label: TOOL_SEARCH_TOOL_NAME,
    description: TOOL_SEARCH_DESCRIPTION,
    promptSnippet: "Search for tools that are not loaded yet and load the matches",
    parameters: toolSearchSchema,

    exposure: "model-only",

    reachesTools: () => "all",
    async execute(_toolCallId, { query, limit }) {
      if (query.trim() === "") throw new Error("query must not be empty");
      const max = limit ?? DEFAULT_TOOL_SEARCH_LIMIT;
      if (!Number.isInteger(max) || max <= 0) throw new Error("limit must be a positive integer");
      const tools = options.tools === undefined ? [] : searchAndLoad(options.tools, query, max);
      const text =
        tools.length === 0
          ? "No matching tools found."
          : `Loaded ${tools.length} tool${tools.length === 1 ? "" : "s"}. They are available from your next call:\n${tools
              .map((tool) => `- ${tool.name}: ${tool.description.trim().split(/\r?\n/u)[0]}`)
              .join("\n")}`;
      return {
        content: [{ type: "text", text }],
        details: { loaded: tools.map((tool) => tool.name) },
      };
    },
  };
}
