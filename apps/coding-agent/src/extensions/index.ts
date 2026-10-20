import type extensionsTypesTypes from "../core/extensions/types.types.ts";
import codemodeExtension from "./codemode/index.ts";
import llamaExtension from "./llama/index.ts";
import mcpExtension from "./mcp/index.ts";
import toolSearchExtension from "./tool-search/index.ts";

const builtInExtensions: extensionsTypesTypes.InlineExtension[] = [
  { builtin: true, factory: llamaExtension, name: "llama.cpp" },

  { builtin: true, factory: codemodeExtension, name: "codemode", replaceable: true },
  { builtin: true, factory: toolSearchExtension, name: "tool-search", replaceable: true },
  { builtin: true, factory: mcpExtension, name: "mcp", replaceable: true },
];

const extensions = {
  builtInExtensions,
};

export default extensions;
