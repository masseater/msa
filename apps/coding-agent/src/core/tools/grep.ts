import type { AgentTool } from "@msa/agent-core";
import type { Static } from "typebox";

import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { abortedBy, nonEmptyOr, platformRuntime, unwrapForeign } from "../platform/index.ts";
import { defaultGrepOperations, runGrep } from "./grep-run.ts";
import {
  DEFAULT_GREP_LIMIT,
  grepSchema,
  type GrepOperations,
  type GrepToolDetails,
} from "./grep-support.ts";
import { resolveToCwd } from "./path-utils.ts";
import { grepRenderers } from "./renderers/grep.ts";
import { type CwdFactory, cwdFactory, wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, GREP_MAX_LINE_LENGTH } from "./truncate.ts";

export { type GrepOperations, type GrepToolDetails } from "./grep-support.ts";

export const grepToolSystemPromptContribution = {
  snippet: "Search file contents for patterns (respects .gitignore)",
  guidelines: [],
} as const;

export type GrepToolInput = Static<typeof grepSchema>;

export interface GrepToolOptions {
  operations?: GrepOperations;
}

type GrepInput = Omit<Static<typeof grepSchema>, "path"> & { path?: string };

const createGrepToolDefinitionImpl = (
  cwd: string,
  options?: GrepToolOptions,
): ToolDefinition<typeof grepSchema, GrepToolDetails | undefined> => {
  const ops = options?.operations ?? defaultGrepOperations;
  return {
    name: "grep",
    label: "grep",
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_GREP_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
    promptSnippet: grepToolSystemPromptContribution.snippet,
    parameters: grepSchema,
    execute: (
      _toolCallId,
      { pattern, path: searchDir, glob, ignoreCase, literal, context, limit }: GrepInput,
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: ExtensionContext,
    ) =>
      platformRuntime.runPromise(
        unwrapForeign(
          runGrep(ops, {
            pattern,
            searchPath: resolveToCwd(nonEmptyOr(searchDir, "."), nonEmptyOr(ctx?.cwd, cwd)),
            glob,
            ignoreCase,
            literal,
            contextValue: context !== undefined && context > 0 ? context : 0,
            effectiveLimit: Math.max(1, limit ?? DEFAULT_GREP_LIMIT),
          }).pipe(abortedBy(signal)),
        ),
      ),
    ...grepRenderers,
  };
};

export const createGrepToolDefinition: CwdFactory<
  GrepToolOptions,
  ToolDefinition<typeof grepSchema, GrepToolDetails | undefined>
> = cwdFactory(createGrepToolDefinitionImpl);

export const createGrepTool: CwdFactory<GrepToolOptions, AgentTool<typeof grepSchema>> = cwdFactory(
  (cwd, options) => wrapToolDefinition(createGrepToolDefinitionImpl(cwd, options)),
);
