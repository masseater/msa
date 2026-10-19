import type { InlineExtension } from "../core/extensions/types.ts";
import codemodeExtension from "./codemode/index.ts";
import llamaExtension from "./llama/index.ts";
import mcpExtension from "./mcp/index.ts";
import toolSearchExtension from "./tool-search/index.ts";

export const builtInExtensions: InlineExtension[] = [
  { name: "llama.cpp", factory: llamaExtension, builtin: true },

  { name: "codemode", factory: codemodeExtension, replaceable: true, builtin: true },
  { name: "tool-search", factory: toolSearchExtension, replaceable: true, builtin: true },
  { name: "mcp", factory: mcpExtension, replaceable: true, builtin: true },
];
