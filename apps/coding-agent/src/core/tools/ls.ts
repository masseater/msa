import * as NodeServices from "@effect/platform-node/NodeServices";
import type agentTypes from "@msa/agent-core/index.types";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { Type } from "typebox";

import errors from "../../utils/errors.ts";
import type extensionsTypesTypes from "../extensions/types.types.ts";
import platform from "../platform/index.ts";
import type lsTypes from "./ls.types.ts";
import pathUtils from "./path-utils.ts";
import lsModule from "./renderers/ls.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";
import truncate from "./truncate.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { pathExists, resolveToCwd } = pathUtils;
const { ToolFailure, abortedBy, fromMaybePromise, nonEmptyOr, pathOperations, rethrowCause } =
  platform;
const { toErrorMessage } = errors;
const { DEFAULT_MAX_BYTES, formatSize, truncateHead } = truncate;
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

const lsToolSystemPromptContribution = {
  guidelines: [],
  snippet: "List directory contents",
} as const;

const DEFAULT_LIMIT = 500;

const defaultLsOperations: lsTypes.LsOperations = {
  exists: pathExists,
  readdir: (absolutePath) =>
    nodeRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.readDirectory(absolutePath))),
    ),
  stat: (absolutePath) =>
    nodeRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.stat(absolutePath)).pipe(
          Effect.map((info) => ({ isDirectory: () => info.type === "Directory" })),
        ),
      ),
    ),
};

const listEntries = Effect.fn("listEntries")(function* (
  ops: lsTypes.LsOperations,
  dirPath: string,
  limit: number,
) {
  const names = yield* Effect.tryPromise({
    catch: (error) =>
      new ToolFailure({ message: `Cannot read directory: ${toErrorMessage(error)}` }),
    try: () => Promise.resolve(ops.readdir(dirPath)),
  });
  const entries = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const results: string[] = [];
  let entryLimitReached = false;
  for (const entry of entries) {
    if (results.length >= limit) {
      entryLimitReached = true;
      break;
    }
    const entryStat = yield* fromMaybePromise(() =>
      ops.stat(pathOperations.join(dirPath, entry)),
    ).pipe(Effect.catchDefect(() => Effect.void));
    if (entryStat === undefined) continue;
    results.push(entry + (entryStat.isDirectory() ? "/" : ""));
  }
  return { entryLimitReached, results };
});

const formatListing = (results: string[], entryLimitReached: boolean, effectiveLimit: number) => {
  if (results.length === 0) {
    return { content: [{ text: "(empty directory)", type: "text" as const }], details: undefined };
  }
  const truncation = truncateHead(results.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
  const details: lsTypes.LsToolDetails = {};
  const notices: string[] = [];
  if (entryLimitReached) {
    notices.push(
      `${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`,
    );
    details.entryLimitReached = effectiveLimit;
  }
  if (truncation.truncated) {
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
    details.truncation = truncation;
  }
  const output =
    notices.length > 0 ? `${truncation.content}\n\n[${notices.join(". ")}]` : truncation.content;
  return {
    content: [{ text: output, type: "text" as const }],
    details: Object.keys(details).length > 0 ? details : undefined,
  };
};

const runLs = Effect.fn("ls")(function* (
  ops: lsTypes.LsOperations,
  dirPath: string,
  effectiveLimit: number,
) {
  const exists = yield* fromMaybePromise(() => ops.exists(dirPath));
  if (!exists) return yield* new ToolFailure({ message: `Path not found: ${dirPath}` });
  const stat = yield* fromMaybePromise(() => ops.stat(dirPath));
  if (!stat.isDirectory())
    return yield* new ToolFailure({ message: `Not a directory: ${dirPath}` });
  const { results, entryLimitReached } = yield* listEntries(ops, dirPath, effectiveLimit);
  return formatListing(results, entryLimitReached, effectiveLimit);
});

const createLsToolDefinitionImpl = (
  cwd: string,
  options?: lsTypes.LsToolOptions,
): extensionsTypesTypes.ToolDefinition<typeof lsSchema, lsTypes.LsToolDetails | undefined> => {
  const ops = options?.operations ?? defaultLsOperations;
  return {
    annotations: { readOnlyHint: true },
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    execute: (
      _toolCallId,
      { path, limit }: { path?: string; limit?: number },
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: extensionsTypesTypes.ExtensionContext,
    ) =>
      nodeRuntime.runPromise(
        Effect.suspend(() =>
          runLs(
            ops,
            resolveToCwd(nonEmptyOr(path, "."), nonEmptyOr(ctx?.cwd, cwd)),
            limit ?? DEFAULT_LIMIT,
          ),
        ).pipe(abortedBy(signal)),
      ),
    label: "ls",
    name: "ls",
    parameters: lsSchema,
    promptSnippet: lsToolSystemPromptContribution.snippet,
    ...lsRenderers,
  };
};

const createLsToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  lsTypes.LsToolOptions,
  extensionsTypesTypes.ToolDefinition<typeof lsSchema, lsTypes.LsToolDetails | undefined>
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
