import type mcpTypes from "@msa/mcp/index.types";
import { dual } from "effect/Function";
import type { TSchema } from "typebox";

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import platformNode from "../../../core/platform-node.ts";
import type configTypes from "../config.types.ts";

const { sha256Hex } = platformNode;

function toToolExposure(exposure: configTypes.McpExposure): extensionsTypesTypes.ToolExposure {
  return exposure === "codemode" ? "deferred" : exposure;
}

const MAX_TOOL_NAME_LENGTH = 64;

function createMcpToolNameImpl(
  server: string,
  tool: string,
  isTaken: (name: string) => boolean = () => false,
): string {
  const name = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/gu, "_");
  if (name.length <= MAX_TOOL_NAME_LENGTH && !isTaken(name)) return name;
  const hash = sha256Hex(`${server}\0${tool}`).slice(0, 8);
  return `${name.slice(0, MAX_TOOL_NAME_LENGTH - hash.length - 1)}_${hash}`;
}

const createMcpToolName: {
  (server: string, tool: string, isTaken?: (name: string) => boolean): string;
  (tool: string, isTaken?: (name: string) => boolean): (server: string) => string;
} = dual((args: IArguments) => args.length >= 2, createMcpToolNameImpl);

function toParameters(schema: Record<string, unknown>): TSchema {
  return {
    ...schema,
    type: schema["type"] ?? "object",
    ...(schema["properties"] === undefined ? { properties: {} } : {}),
  } as unknown as TSchema;
}

const ANNOTATION_HINTS = [
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
] as const;

function toToolAnnotations(tool: mcpTypes.Tool): extensionsTypesTypes.ToolAnnotations | undefined {
  const annotations: extensionsTypesTypes.ToolAnnotations = {};
  for (const hint of ANNOTATION_HINTS) {
    const value = tool.annotations?.[hint];
    if (typeof value === "boolean") annotations[hint] = value;
  }
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

const toolShape = { createMcpToolName, toParameters, toToolAnnotations, toToolExposure };

export default toolShape;
