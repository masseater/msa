import type agentTypes from "@msa/agent-core/index.types";
import type { Static } from "typebox";

import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { abortedBy, nonEmptyOr, platformRuntime, unwrapForeign } from "../platform/index.ts";
import { globWithFd } from "./find-fd.ts";
import {
  DEFAULT_FIND_LIMIT,
  type FindOperations,
  type FindToolDetails,
  findSchema,
  globWithOperations,
} from "./find-support.ts";
import { resolveToCwd } from "./path-utils.ts";
import { findRenderers } from "./renderers/find.ts";
import { type CwdFactory, cwdFactory, wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES } from "./truncate.ts";

export {
  relativizeFindResultPath,
  type FindOperations,
  type FindToolDetails,
} from "./find-support.ts";

export const findToolSystemPromptContribution = {
  guidelines: [],
  snippet: "Find files by glob pattern (respects .gitignore)",
} as const;

export type FindToolInput = Static<typeof findSchema>;

export interface FindToolOptions {
  operations?: FindOperations;
}

const createFindToolDefinitionImpl = (
  cwd: string,
  options?: FindToolOptions,
): ToolDefinition<typeof findSchema, FindToolDetails | undefined> => {
  const customOps = options?.operations;
  return {
    annotations: { readOnlyHint: true },
    description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_FIND_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    execute: (
      _toolCallId,
      { pattern, path: searchDir, limit }: { pattern: string; path?: string; limit?: number },
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: ExtensionContext,
    ) => {
      const request = {
        pattern,
        searchPath: resolveToCwd(nonEmptyOr(searchDir, "."), nonEmptyOr(ctx?.cwd, cwd)),
        effectiveLimit: limit ?? DEFAULT_FIND_LIMIT,
      };
      const search =
        customOps?.glob === undefined
          ? globWithFd(request)
          : globWithOperations(customOps, request);
      return platformRuntime.runPromise(unwrapForeign(search.pipe(abortedBy(signal))));
    },
    label: "find",
    name: "find",
    parameters: findSchema,
    promptSnippet: findToolSystemPromptContribution.snippet,
    ...findRenderers,
  };
};

export const createFindToolDefinition: CwdFactory<
  FindToolOptions,
  ToolDefinition<typeof findSchema, FindToolDetails | undefined>
> = cwdFactory(createFindToolDefinitionImpl);

export const createFindTool: CwdFactory<
  FindToolOptions,
  agentTypes.AgentTool<typeof findSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createFindToolDefinitionImpl(cwd, options)));
