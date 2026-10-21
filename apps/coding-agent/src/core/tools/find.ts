import type agentTypes from "@msa/agent-core/index.types";

import platform from "../platform/index.ts";
import findSearch from "./find-search.ts";
import findSupport from "./find-support.ts";
import type findTypes from "./find.types.ts";
import findModule from "./renderers/find.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";
import truncate from "./truncate.ts";

const { DEFAULT_FIND_LIMIT, findSchema } = findSupport;
const { DEFAULT_MAX_BYTES } = truncate;
const { nonEmptyOr } = platform;
const { searchFiles } = findSearch;
const { findRenderers } = findModule;
const { cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const findToolSystemPromptContribution = {
  guidelines: [],
  snippet: "Find files by glob pattern (respects .gitignore)",
} as const;

const createFindToolDefinitionImpl = (
  cwd: string,
  options?: findTypes.FindToolOptions,
): findTypes.FindToolDefinition => ({
  annotations: { readOnlyHint: true },
  description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_FIND_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
  execute: (
    _toolCallId,
    input: findTypes.FindToolInput,
    signal?: AbortSignal,
    _onUpdate?,
    ctx?: findTypes.FindToolContext,
  ) => searchFiles({ cwd: nonEmptyOr(ctx?.cwd, cwd), input, ops: options?.operations, signal }),
  label: "find",
  name: "find",
  parameters: findSchema,
  promptSnippet: findToolSystemPromptContribution.snippet,
  ...findRenderers,
});

const createFindToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  findTypes.FindToolOptions,
  findTypes.FindToolDefinition
> = cwdFactory(createFindToolDefinitionImpl);

const createFindTool: toolDefinitionWrapperTypes.CwdFactory<
  findTypes.FindToolOptions,
  agentTypes.AgentTool<typeof findSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createFindToolDefinitionImpl(cwd, options)));

const find = {
  createFindTool,
  createFindToolDefinition,
  findToolSystemPromptContribution,
  relativizeFindResultPath: findSupport.relativizeFindResultPath,
};

export default find;
