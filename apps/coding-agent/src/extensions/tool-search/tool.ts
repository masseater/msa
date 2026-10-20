import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import Bm25Ranker from "./bm-25-ranker.ts";
import type toolTypes from "./tool.types.ts";

const TOOL_SEARCH_TOOL_NAME = "tool_search";
const DEFAULT_TOOL_SEARCH_LIMIT = 8;
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
function createToolSearchDocumentImpl(
  tool: Pick<extensionsTypesTypes.ToolInfo, "name" | "description" | "parameters">,
  namespace?: extensionsTypesTypes.ToolNamespace,
): toolTypes.ToolSearchDocument {
  const parts = [tool.name, tool.name.replaceAll("_", " "), tool.description];
  schemaText(tool.parameters, parts);
  if (namespace !== undefined)
    parts.push(namespace.name, namespace.description ?? "", namespace.instructions ?? "");
  return { name: tool.name, text: parts.filter((part) => part.trim()).join(" ") };
}
const createToolSearchDocument: {
  (
    tool: Pick<extensionsTypesTypes.ToolInfo, "name" | "description" | "parameters">,
    namespace?: extensionsTypesTypes.ToolNamespace,
  ): toolTypes.ToolSearchDocument;
  (
    namespace?: extensionsTypesTypes.ToolNamespace,
  ): (
    tool: Pick<extensionsTypesTypes.ToolInfo, "name" | "description" | "parameters">,
  ) => toolTypes.ToolSearchDocument;
} = dual((args: IArguments) => args.length >= 1, createToolSearchDocumentImpl);
const toolSearchSchema = Type.Object({
  limit: Type.Optional(
    Type.Number({
      description: `Maximum number of tools to return. Defaults to ${DEFAULT_TOOL_SEARCH_LIMIT}.`,
    }),
  ),
  query: Type.String({ description: "Search query for deferred tools." }),
});
function isSearchable(exposure: extensionsTypesTypes.ToolExposure): boolean {
  return exposure === "codemode" || exposure === "deferred";
}
function searchAndLoad(
  tools: NonNullable<toolTypes.ToolSearchToolOptions["tools"]>,
  query: string,
  limit: number,
): toolTypes.ToolSearchResultTool[] {
  const active = tools.getActiveTools();
  const candidates = tools
    .getAllTools()
    .filter((tool) => isSearchable(tool.exposure) && !active.includes(tool.name));
  const documents = candidates.map((tool) => createToolSearchDocument(tool, tool.namespace));
  const matches = new Bm25Ranker().rank(query, documents, limit);
  if (matches.length > 0) tools.setActiveTools([...active, ...matches.map((match) => match.name)]);
  return matches.map((match) => ({
    description: candidates.find((tool) => tool.name === match.name)?.description ?? "",
    name: match.name,
  }));
}
const TOOL_SEARCH_DESCRIPTION = `# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.\n\nSome of the tools, such as tools of MCP servers, may not have been provided to you upfront, and you should use this tool (\`${TOOL_SEARCH_TOOL_NAME}\`) to search for the required tools. For MCP tool discovery, always use \`${TOOL_SEARCH_TOOL_NAME}\`.`;
function createToolSearchToolDefinition(
  options: toolTypes.ToolSearchToolOptions = {},
): extensionsTypesTypes.ToolDefinition<typeof toolSearchSchema, toolTypes.ToolSearchToolDetails> {
  return {
    description: TOOL_SEARCH_DESCRIPTION,
    execute(_toolCallId, { query, limit }) {
      return Effect.runPromise(
        Effect.sync(() => {
          if (query.trim() === "") throw new Error("query must not be empty");
          const max = limit ?? DEFAULT_TOOL_SEARCH_LIMIT;
          if (!Number.isInteger(max) || max <= 0)
            throw new Error("limit must be a positive integer");
          const tools = options.tools === undefined ? [] : searchAndLoad(options.tools, query, max);
          const text =
            tools.length === 0
              ? "No matching tools found."
              : `Loaded ${tools.length} tool${tools.length === 1 ? "" : "s"}. They are available from your next call:\n${tools
                  .map((tool) => `- ${tool.name}: ${tool.description.trim().split(/\r?\n/u)[0]}`)
                  .join("\n")}`;
          return {
            content: [{ text, type: "text" }],
            details: { loaded: tools.map((tool) => tool.name) },
          };
        }),
      );
    },
    exposure: "model-only",
    label: TOOL_SEARCH_TOOL_NAME,
    name: TOOL_SEARCH_TOOL_NAME,
    parameters: toolSearchSchema,
    promptSnippet: "Search for tools that are not loaded yet and load the matches",
    reachesTools: () => "all",
  };
}

const tool = {
  DEFAULT_TOOL_SEARCH_LIMIT,
  TOOL_SEARCH_DESCRIPTION,
  TOOL_SEARCH_TOOL_NAME,
  createToolSearchDocument,
  createToolSearchToolDefinition,
  toolSearchSchema,
};

export default tool;
