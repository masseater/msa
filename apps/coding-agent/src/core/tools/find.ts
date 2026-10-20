import type agentTypes from "@msa/agent-core/index.types";
import { Effect } from "effect";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import platform from "../platform/index.ts";
import findFd from "./find-fd.ts";
import findSupport from "./find-support.ts";
import type findSupportTypes from "./find-support.types.ts";
import type findTypes from "./find.types.ts";
import pathUtils from "./path-utils.ts";
import findModule from "./renderers/find.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";
import truncate from "./truncate.ts";

const { DEFAULT_FIND_LIMIT, findSchema, globWithOperations } = findSupport;
const { DEFAULT_MAX_BYTES } = truncate;
const { resolveToCwd } = pathUtils;
const { abortedBy, nonEmptyOr, unwrapForeign } = platform;
const { globWithFd } = findFd;
const { findRenderers } = findModule;
const { cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const findToolSystemPromptContribution = {
  guidelines: [],
  snippet: "Find files by glob pattern (respects .gitignore)",
} as const;

const createFindToolDefinitionImpl = (
  cwd: string,
  options?: findTypes.FindToolOptions,
): extensionsTypesTypes.ToolDefinition<
  typeof findSchema,
  findSupportTypes.FindToolDetails | undefined
> => {
  const customOps = options?.operations;
  return {
    annotations: { readOnlyHint: true },
    description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_FIND_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    execute: (
      _toolCallId,
      { pattern, path: searchDir, limit }: { pattern: string; path?: string; limit?: number },
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: extensionsTypesTypes.ExtensionContext,
    ) => {
      const request = {
        effectiveLimit: limit ?? DEFAULT_FIND_LIMIT,
        pattern,
        searchPath: resolveToCwd(nonEmptyOr(searchDir, "."), nonEmptyOr(ctx?.cwd, cwd)),
      };
      const search =
        customOps?.glob === undefined
          ? globWithFd(request)
          : globWithOperations(customOps, request);
      return Effect.runPromise(unwrapForeign(search.pipe(abortedBy(signal))));
    },
    label: "find",
    name: "find",
    parameters: findSchema,
    promptSnippet: findToolSystemPromptContribution.snippet,
    ...findRenderers,
  };
};

const createFindToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  findTypes.FindToolOptions,
  extensionsTypesTypes.ToolDefinition<
    typeof findSchema,
    findSupportTypes.FindToolDetails | undefined
  >
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
