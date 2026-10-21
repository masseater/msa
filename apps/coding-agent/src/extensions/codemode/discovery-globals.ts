import type agentTypes from "@msa/agent-core/index.types";
import codemode from "@msa/codemode";
import type codemodeTypes from "@msa/codemode/index.types";

import type extensionsTypesTypes from "../../core/extensions/types.types.ts";
import Bm25Ranker from "../tool-search/bm-25-ranker.ts";
import toolSearchTool from "../tool-search/tool.ts";
import type toolTypes from "./tool.types.ts";

const { DEFAULT_TOOL_SEARCH_LIMIT, createToolSearchDocument } = toolSearchTool;
const { toCodemodeIdentifier } = codemode;

function isNamespaceName(namespace: extensionsTypesTypes.ToolNamespace, query: string): boolean {
  const queryId = toCodemodeIdentifier(query);
  return [namespace.name, ...(namespace.aliases ?? [])].some(
    (name) => name === query || toCodemodeIdentifier(name) === queryId,
  );
}

function createDiscoveryGlobals(
  tools: readonly agentTypes.AgentTool<any>[],
  samples: ReadonlyMap<string, string>,
  options: toolTypes.CodemodeToolOptions,
): codemodeTypes.CodemodeTool[] {
  const ranker = new Bm25Ranker();
  const entry = (name: string) => ({
    description: samples.get(name) ?? "",
    name: toCodemodeIdentifier(name),
  });
  return [
    {
      execute: (args) => searchTools(args, tools, options, ranker, entry),
      name: "searchTools",
      spread: true,
    },
    {
      execute: (args) => describeTool(args, tools, samples),
      name: "describeTool",
      spread: true,
    },
    {
      execute: (args) => {
        const [name] = args as unknown[];
        if (typeof name !== "string")
          throw new Error("describeNamespace() expects a namespace name");
        let namespace: extensionsTypesTypes.ToolNamespace | undefined;
        const names: string[] = [];
        for (const tool of tools) {
          const toolNamespace = options.getToolNamespace?.(tool.name);
          if (toolNamespace === undefined || !isNamespaceName(toolNamespace, name)) continue;
          namespace ??= toolNamespace;
          names.push(toCodemodeIdentifier(tool.name));
        }
        if (namespace === undefined) return undefined;
        return describeNamespace(namespace, names);
      },
      name: "describeNamespace",
      spread: true,
    },
  ];
}

function describeTool(
  args: unknown,
  tools: readonly agentTypes.AgentTool<any, any>[],
  samples: ReadonlyMap<string, string>,
) {
  const [name] = args as unknown[];
  if (typeof name !== "string") throw new Error("describeTool() expects a tool name");
  const tool = tools.find(
    (candidate) => candidate.name === name || toCodemodeIdentifier(candidate.name) === name,
  );
  return tool === undefined ? undefined : samples.get(tool.name);
}

function describeNamespace(
  namespace: extensionsTypesTypes.ToolNamespace,
  names: string[],
): unknown {
  return {
    name: namespace.name,
    ...(namespace.description !== undefined && namespace.description !== ""
      ? { description: namespace.description }
      : {}),
    ...(namespace.instructions !== undefined && namespace.instructions !== ""
      ? { instructions: namespace.instructions }
      : {}),
    tools: names,
  };
}

function searchTools(
  args: unknown,
  tools: readonly agentTypes.AgentTool<any, any>[],
  options: toolTypes.CodemodeToolOptions,
  ranker: Bm25Ranker,
  entry: (name: string) => { description: string; name: string },
) {
  const [query, searchOptions] = args as [
    unknown,
    { limit?: unknown; namespace?: unknown } | undefined,
  ];
  if (typeof query !== "string") throw new Error("searchTools() expects a query string");
  const limit = searchOptions?.limit ?? DEFAULT_TOOL_SEARCH_LIMIT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
    throw new Error("searchTools() limit must be a positive integer");
  }
  const namespace = searchOptions?.namespace;
  if (namespace !== undefined && namespace !== null && typeof namespace !== "string") {
    throw new Error("searchTools() namespace must be a string");
  }
  const documents = tools.flatMap((tool) => {
    const toolNamespace = options.getToolNamespace?.(tool.name);
    if (
      namespace !== undefined &&
      namespace !== null &&
      namespace !== "" &&
      (toolNamespace === undefined || !isNamespaceName(toolNamespace, namespace))
    )
      return [];
    return [createToolSearchDocument(tool, toolNamespace)];
  });
  return ranker.rank(query, documents, limit).map((match) => entry(match.name));
}

const discoveryGlobals = { createDiscoveryGlobals };

export default discoveryGlobals;
