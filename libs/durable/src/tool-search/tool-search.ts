import { Type } from "@msa/ai";
import { Effect } from "effect";

import define from "../harness/define.ts";
import type typesModule from "../harness/types.types.ts";
import search from "../search.ts";
import type toolSearchTypes from "./tool-search.types.ts";

const { defineExtension, defineTool } = define;
const { rankDocuments } = search;

const TOOL_SEARCH_TOOL_NAME = "tool_search";
const DEFAULT_TOOL_SEARCH_LIMIT = 8;

const TOOL_SEARCH_DESCRIPTION = `# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.\n\nSome of the tools, such as tools of MCP servers, may not have been provided to you upfront, and you should use this tool (\`${TOOL_SEARCH_TOOL_NAME}\`) to search for the required tools. For MCP tool discovery, always use \`${TOOL_SEARCH_TOOL_NAME}\`.`;

const toolSearchSchema = Type.Object({
  limit: Type.Optional(
    Type.Number({
      description: `Maximum number of tools to return. Defaults to ${DEFAULT_TOOL_SEARCH_LIMIT}.`,
    }),
  ),
  query: Type.String({ description: "Search query for deferred tools." }),
});

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

function searchText(tool: typesModule.ToolRegistration): string {
  const parts = [tool.name, tool.name.replaceAll("_", " "), tool.description];
  schemaText(tool.parameters, parts);
  return parts.filter((part) => part.trim() !== "").join(" ");
}

function createToolSearchTool() {
  return defineTool({
    callers: ["model"],
    description: TOOL_SEARCH_DESCRIPTION,
    execute({ query, limit }, api, context) {
      return Effect.runPromise(
        Effect.gen(function* () {
          if (query.trim() === "") throw new Error("query must not be empty");
          const max = limit ?? DEFAULT_TOOL_SEARCH_LIMIT;
          if (!Number.isInteger(max) || max <= 0)
            throw new Error("limit must be a positive integer");
          const candidates = (yield* Effect.promise(() => api.agent(context))).deferred;
          const documents = candidates.map((tool) => ({ name: tool.name, text: searchText(tool) }));
          const loaded = rankDocuments(query, documents, max);
          const text =
            loaded.length === 0
              ? "No matching tools found."
              : `Loaded ${loaded.length} tool${loaded.length === 1 ? "" : "s"}. They are available from your next call:\n${loaded
                  .map((name) => {
                    const description =
                      candidates.find((tool) => tool.name === name)?.description ?? "";
                    return `- ${name}: ${description.trim().split(/\r?\n/u)[0]}`;
                  })
                  .join("\n")}`;
          const details: toolSearchTypes.ToolSearchToolDetails = { loaded };
          return {
            details,
            output: [{ text, type: "text" }],
            ...(loaded.length === 0 ? {} : { control: { addTools: loaded } }),
          };
        }),
      );
    },
    name: TOOL_SEARCH_TOOL_NAME,
    parameters: toolSearchSchema,
    replay: "safe",
  });
}

function createToolSearchExtension() {
  return defineExtension({ name: "tool-search", tools: [createToolSearchTool()] });
}

const toolSearch = {
  DEFAULT_TOOL_SEARCH_LIMIT,
  TOOL_SEARCH_TOOL_NAME,
  createToolSearchExtension,
  createToolSearchTool,
};

export default toolSearch;
