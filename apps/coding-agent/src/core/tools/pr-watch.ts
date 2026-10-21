import { Effect } from "effect";
import { Type } from "typebox";

import ask from "../ask.ts";
import type extensionsTypesTypes from "../extensions/types.types.ts";
import type serviceTypes from "../pr-watch/service.types.ts";
import type snapshotTypes from "../pr-watch/snapshot.types.ts";
import summary from "../pr-watch/summary.ts";
import watchModule from "../pr-watch/watch.ts";
import type prWatchTypes from "./pr-watch.types.ts";

const { prWatchKey, prWatchLabel } = watchModule;
const { describePrWatchStatus } = summary;
const { readOnlyVariantOf } = ask;

const prWatchSchema = Type.Object({
  action: Type.Union([Type.Literal("watch"), Type.Literal("stop"), Type.Literal("list")], {
    description:
      "watch: start watching a pull request in the background; stop: stop watching one; list: show the watched pull requests and their last state",
  }),
  intervalSeconds: Type.Optional(
    Type.Number({
      description:
        "Seconds between checks (action: watch). Default: the prWatch.intervalSeconds setting",
    }),
  ),
  number: Type.Optional(Type.Number({ description: "Pull request number (actions: watch, stop)" })),
  repository: Type.Optional(
    Type.String({
      description:
        "owner/repo of the pull request. Default: the GitHub repository of the working directory",
    }),
  ),
});

const prWatchReadSchema = Type.Object({
  action: Type.Literal("list", {
    description: "list: show the watched pull requests and their last state",
  }),
});

const prWatchToolSystemPromptContribution = {
  guidelines: [
    "Use pr_watch instead of polling a pull request with gh: it returns immediately and reports each change once",
  ],
  snippet:
    "Watch a GitHub pull request in the background and report CI, review, merge, close, and conflict changes to this session",
} as const;

const MIN_INTERVAL_MS = 5_000;

function targetFromInput(input: prWatchTypes.PrWatchToolInput): snapshotTypes.PrWatchTarget {
  const number = input.number;
  if (number === undefined || !Number.isInteger(number) || number <= 0) {
    throw new Error(`action ${input.action} requires a pull request number`);
  }
  const repository = input.repository?.trim();
  return repository !== undefined && repository !== "" ? { number, repository } : { number };
}

function intervalFromInput(input: prWatchTypes.PrWatchToolInput): number | undefined {
  const value = input.intervalSeconds;
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("intervalSeconds must be a positive number of seconds");
  }
  return Math.max(Math.round(value * 1000), MIN_INTERVAL_MS);
}

function seconds(intervalMs: number): number {
  return Math.round(intervalMs / 1000);
}

function describeWatch(
  service: serviceTypes.PrWatch,
  input: prWatchTypes.PrWatchToolInput,
): string {
  const target = targetFromInput(input);
  const outcome = service.watch(target, intervalFromInput(input));
  const entry = outcome.entry;
  if (!outcome.started) {
    return `Already watching ${entry.label} every ${seconds(entry.intervalMs)}s`;
  }
  return `Watching ${entry.label} every ${seconds(entry.intervalMs)}s`;
}

function describeStop(service: serviceTypes.PrWatch, input: prWatchTypes.PrWatchToolInput): string {
  const target = targetFromInput(input);
  const label = prWatchLabel(target);
  return service.stop(target) ? `Stopped watching ${label}` : `Not watching ${label}`;
}

function describeList(service: serviceTypes.PrWatch): string {
  return describePrWatchStatus(service.snapshot()).join("\n");
}

function createPrWatchToolDefinition(
  service: serviceTypes.PrWatch,
): extensionsTypesTypes.ToolDefinition<typeof prWatchSchema, prWatchTypes.PrWatchToolDetails> {
  const prWatch: extensionsTypesTypes.ToolDefinition<
    typeof prWatchSchema,
    prWatchTypes.PrWatchToolDetails
  > = {
    description:
      "Watch a GitHub pull request in the background through the gh CLI and report changes to this session: CI finished, a review arrived, it was merged or closed, or it conflicts with its base. Registering returns at once, and registering the same pull request twice keeps one watch. Watches live and die with this session.",
    execute(
      _toolCallId,
      params,
    ): Promise<extensionsTypesTypes.AgentToolResult<prWatchTypes.PrWatchToolDetails>> {
      return Effect.runPromise(
        Effect.sync(() => {
          const text =
            params.action === "list"
              ? describeList(service)
              : params.action === "stop"
                ? describeStop(service, params)
                : describeWatch(service, params);
          return {
            content: [{ text, type: "text" as const }],
            details: {
              action: params.action,
              watching: service.snapshot().entries.map((entry) => prWatchKey(entry.target)),
            },
          };
        }),
      );
    },
    label: "pr_watch",
    name: "pr_watch",
    parameters: prWatchSchema,
    promptGuidelines: [...prWatchToolSystemPromptContribution.guidelines],
    promptSnippet: prWatchToolSystemPromptContribution.snippet,
  };
  return {
    ...prWatch,
    readOnlyVariant: readOnlyVariantOf(prWatch, {
      actions: ["list"],
      description:
        "Show the pull requests this session watches and their last state. Starting or stopping a watch is not available here.",
      parameters: prWatchReadSchema,
      promptSnippet: "List the pull requests this session watches",
    }),
  };
}

const prWatch = {
  createPrWatchToolDefinition,
  prWatchSchema,
  prWatchToolSystemPromptContribution,
};

export default prWatch;
