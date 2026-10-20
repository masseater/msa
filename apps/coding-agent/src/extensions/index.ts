import type { InlineExtension } from "../core/extensions/types.ts";
import codemodeExtension from "./codemode/index.ts";
import llamaExtension from "./llama/index.ts";
import mcpExtension from "./mcp/index.ts";
import toolSearchExtension from "./tool-search/index.ts";

export const builtInExtensions: InlineExtension[] = [
  { builtin: true, factory: llamaExtension, name: "llama.cpp" },

  { builtin: true, factory: codemodeExtension, name: "codemode", replaceable: true },
  { builtin: true, factory: toolSearchExtension, name: "tool-search", replaceable: true },
  { builtin: true, factory: mcpExtension, name: "mcp", replaceable: true },
];
