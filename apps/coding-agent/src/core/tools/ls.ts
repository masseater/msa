import type agentTypes from "@msa/agent-core/index.types";
import { Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import platform from "../platform/index.ts";
import lsDirectory from "./ls-directory.ts";
import type lsTypes from "./ls.types.ts";
import lsModule from "./renderers/ls.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";
import truncate from "./truncate.ts";

const { nonEmptyOr } = platform;
const { defaultLsOperations, listDirectory } = lsDirectory;
const { DEFAULT_MAX_BYTES } = truncate;
const { lsRenderers } = lsModule;
const { cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const lsSchema = Type.Object({
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of entries to return (default: 500)" }),
  ),
  path: Type.Optional(
    Type.String({ description: "Directory to list (default: current directory)" }),
  ),
});

type LsToolDefinition = extensionsTypesTypes.ToolDefinition<
  typeof lsSchema,
  lsTypes.LsToolDetails | undefined
>;

const lsToolSystemPromptContribution = {
  guidelines: [],
  snippet: "List directory contents",
} as const;

const DEFAULT_LIMIT = 500;

const createLsToolDefinitionImpl = (
  cwd: string,
  options?: lsTypes.LsToolOptions,
): LsToolDefinition => {
  const ops = options?.operations ?? defaultLsOperations;
  return {
    annotations: { readOnlyHint: true },
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    execute: (
      _toolCallId,
      { path, limit }: { path?: string; limit?: number },
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: lsTypes.LsToolContext,
    ) =>
      listDirectory({
        cwd: nonEmptyOr(ctx?.cwd, cwd),
        limit: limit ?? DEFAULT_LIMIT,
        ops,
        path: nonEmptyOr(path, "."),
        signal,
      }),
    label: "ls",
    name: "ls",
    parameters: lsSchema,
    promptSnippet: lsToolSystemPromptContribution.snippet,
    ...lsRenderers,
  };
};

const createLsToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  lsTypes.LsToolOptions,
  LsToolDefinition
> = cwdFactory(createLsToolDefinitionImpl);

const createLsTool: toolDefinitionWrapperTypes.CwdFactory<
  lsTypes.LsToolOptions,
  agentTypes.AgentTool<typeof lsSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createLsToolDefinitionImpl(cwd, options)));

const ls = {
  createLsTool,
  createLsToolDefinition,
  lsSchema,
  lsToolSystemPromptContribution,
};

export default ls;
