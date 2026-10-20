import type agentTypes from "@msa/agent-core/index.types";
import { Effect } from "effect";
import type { Static } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import platform from "../platform/index.ts";
import grepRun from "./grep-run.ts";
import grepSupport from "./grep-support.ts";
import type grepSupportTypes from "./grep-support.types.ts";
import type grepTypes from "./grep.types.ts";
import pathUtils from "./path-utils.ts";
import grepModule from "./renderers/grep.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";
import truncate from "./truncate.ts";

const { DEFAULT_GREP_LIMIT, grepSchema } = grepSupport;
const { defaultGrepOperations, runGrep } = grepRun;
const { DEFAULT_MAX_BYTES, GREP_MAX_LINE_LENGTH } = truncate;
const { abortedBy, nonEmptyOr, unwrapForeign } = platform;
const { resolveToCwd } = pathUtils;
const { grepRenderers } = grepModule;
const { cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const grepToolSystemPromptContribution = {
  guidelines: [],
  snippet: "Search file contents for patterns (respects .gitignore)",
} as const;

type GrepInput = Omit<Static<typeof grepSchema>, "path"> & { path?: string };

const createGrepToolDefinitionImpl = (
  cwd: string,
  options?: grepTypes.GrepToolOptions,
): extensionsTypesTypes.ToolDefinition<
  typeof grepSchema,
  grepSupportTypes.GrepToolDetails | undefined
> => {
  const ops = options?.operations ?? defaultGrepOperations;
  return {
    annotations: { readOnlyHint: true },
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_GREP_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
    execute: (
      _toolCallId,
      { pattern, path: searchDir, glob, ignoreCase, literal, context, limit }: GrepInput,
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: extensionsTypesTypes.ExtensionContext,
    ) =>
      Effect.runPromise(
        unwrapForeign(
          runGrep(ops, {
            contextValue: context !== undefined && context > 0 ? context : 0,
            effectiveLimit: Math.max(1, limit ?? DEFAULT_GREP_LIMIT),
            glob,
            ignoreCase,
            literal,
            pattern,
            searchPath: resolveToCwd(nonEmptyOr(searchDir, "."), nonEmptyOr(ctx?.cwd, cwd)),
          }).pipe(abortedBy(signal)),
        ),
      ),
    label: "grep",
    name: "grep",
    parameters: grepSchema,
    promptSnippet: grepToolSystemPromptContribution.snippet,
    ...grepRenderers,
  };
};

const createGrepToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  grepTypes.GrepToolOptions,
  extensionsTypesTypes.ToolDefinition<
    typeof grepSchema,
    grepSupportTypes.GrepToolDetails | undefined
  >
> = cwdFactory(createGrepToolDefinitionImpl);

const createGrepTool: toolDefinitionWrapperTypes.CwdFactory<
  grepTypes.GrepToolOptions,
  agentTypes.AgentTool<typeof grepSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createGrepToolDefinitionImpl(cwd, options)));

const grep = {
  createGrepTool,
  createGrepToolDefinition,
  grepToolSystemPromptContribution,
};

export default grep;
