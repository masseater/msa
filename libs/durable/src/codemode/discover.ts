import type { JsonValue } from "@msa/chord";
import { type CodemodeHostCall, toCodemodeIdentifier } from "@msa/codemode/portable";
import { Function } from "effect";

import type { Dual2 } from "../dual.ts";
import { rankDocuments } from "../search.ts";
import type { DeclaredTool, Start } from "./run-docs.ts";

const DEFAULT_SEARCH_LIMIT = 8;

type Namespace = Start["namespaces"][number];

const matchesNamespace = (namespace: Namespace, query: string): boolean =>
  namespace.name === query || toCodemodeIdentifier(namespace.name) === toCodemodeIdentifier(query);

function describeNamespace(namespaces: readonly Namespace[], name: unknown): JsonValue | undefined {
  if (typeof name !== "string") throw new Error("describeNamespace() expects a namespace name");
  const namespace = namespaces.find((candidate) => matchesNamespace(candidate, name));
  if (namespace === undefined) return undefined;
  return {
    name: namespace.name,
    ...(namespace.description === undefined ? {} : { description: namespace.description }),
    ...(namespace.instructions === undefined ? {} : { instructions: namespace.instructions }),
    tools: namespace.tools.map((tool) => toCodemodeIdentifier(tool)),
  };
}

function searchOptions(options: { limit?: unknown; namespace?: unknown } | undefined) {
  const limit = options?.limit ?? DEFAULT_SEARCH_LIMIT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit <= 0) {
    throw new Error("searchTools() limit must be a positive integer");
  }
  const namespace = options?.namespace;
  if (namespace !== undefined && namespace !== null && typeof namespace !== "string") {
    throw new Error("searchTools() namespace must be a string");
  }
  return { limit, namespace: typeof namespace === "string" ? namespace : undefined };
}

function searchTools(
  namespaces: readonly Namespace[],
  tools: readonly DeclaredTool[],
  args: readonly unknown[],
): JsonValue {
  const [query, options] = args as [unknown, { limit?: unknown; namespace?: unknown } | undefined];
  if (typeof query !== "string") throw new Error("searchTools() expects a query string");
  const { limit, namespace } = searchOptions(options);
  const documents = tools.flatMap((tool) => {
    const own = namespaces.find((candidate) => candidate.tools.includes(tool.name));
    if (namespace !== undefined && (own === undefined || !matchesNamespace(own, namespace)))
      return [];
    const text = [
      tool.name,
      tool.name.replaceAll("_", " "),
      tool.description,
      own?.name ?? "",
      own?.description ?? "",
    ];
    return [{ name: tool.name, text: text.join(" ") }];
  });
  return rankDocuments(query, documents, limit).map((name) => {
    const tool = tools.find((candidate) => candidate.name === name)!;
    return { name: tool.jsName, description: tool.description };
  });
}

export const discover: Dual2<Start, CodemodeHostCall, JsonValue | undefined> = Function.dual(
  2,
  (start: Start, call: CodemodeHostCall): JsonValue | undefined => {
    const args = Array.isArray(call.args) ? call.args : [];
    const tools = start.tools.filter((tool) => tool.hidden !== true);
    if (call.name === "describeTool") {
      const [name] = args;
      if (typeof name !== "string") throw new Error("describeTool() expects a tool name");
      return tools.find((tool) => tool.name === name || tool.jsName === name)?.description;
    }
    if (call.name === "describeNamespace") return describeNamespace(start.namespaces, args[0]);
    return searchTools(start.namespaces, tools, args);
  },
);
