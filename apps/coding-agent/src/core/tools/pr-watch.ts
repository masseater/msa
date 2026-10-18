import { Effect } from "effect";
import { type Static, Type } from "typebox";

import type { AgentToolResult, ToolDefinition } from "../extensions/types.ts";
import type { PrWatch } from "../pr-watch/service.ts";
import type { PrWatchTarget } from "../pr-watch/snapshot.ts";
import { describePrWatchStatus } from "../pr-watch/summary.ts";
import { prWatchKey, prWatchLabel } from "../pr-watch/watch.ts";

const prWatchSchema = Type.Object({
  action: Type.Union([Type.Literal("watch"), Type.Literal("stop"), Type.Literal("list")], {
    description:
      "watch: start watching a pull request in the background; stop: stop watching one; list: show the watched pull requests and their last state",
  }),
  number: Type.Optional(Type.Number({ description: "Pull request number (actions: watch, stop)" })),
  repository: Type.Optional(
    Type.String({
      description:
        "owner/repo of the pull request. Default: the GitHub repository of the working directory",
    }),
  ),
  intervalSeconds: Type.Optional(
    Type.Number({
      description:
        "Seconds between checks (action: watch). Default: the prWatch.intervalSeconds setting",
    }),
  ),
});

export type PrWatchToolInput = Static<typeof prWatchSchema>;

export interface PrWatchToolDetails {
  readonly action: string;
  readonly watching: readonly string[];
}

export const prWatchToolSystemPromptContribution = {
  snippet:
    "Watch a GitHub pull request in the background and report CI, review, merge, close, and conflict changes to this session",
  guidelines: [
    "Use pr_watch instead of polling a pull request with gh: it returns immediately and reports each change once",
  ],
} as const;

const MIN_INTERVAL_MS = 5_000;

function targetFromInput(input: PrWatchToolInput): PrWatchTarget {
  const number = input.number;
  if (number === undefined || !Number.isInteger(number) || number <= 0) {
    throw new Error(`action ${input.action} requires a pull request number`);
  }
  const repository = input.repository?.trim();
  return repository ? { number, repository } : { number };
}

function intervalFromInput(input: PrWatchToolInput): number | undefined {
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

function describeWatch(service: PrWatch, input: PrWatchToolInput): string {
  const target = targetFromInput(input);
  const outcome = service.watch(target, intervalFromInput(input));
  const entry = outcome.entry;
  if (!outcome.started) {
    return `Already watching ${entry.label} every ${seconds(entry.intervalMs)}s`;
  }
  return `Watching ${entry.label} every ${seconds(entry.intervalMs)}s`;
}

function describeStop(service: PrWatch, input: PrWatchToolInput): string {
  const target = targetFromInput(input);
  const label = prWatchLabel(target);
  return service.stop(target) ? `Stopped watching ${label}` : `Not watching ${label}`;
}

function describeList(service: PrWatch): string {
  return describePrWatchStatus(service.snapshot()).join("\n");
}

export function createPrWatchToolDefinition(
  service: PrWatch,
): ToolDefinition<typeof prWatchSchema, PrWatchToolDetails> {
  return {
    name: "pr_watch",
    label: "pr_watch",
    description:
      "Watch a GitHub pull request in the background through the gh CLI and report changes to this session: CI finished, a review arrived, it was merged or closed, or it conflicts with its base. Registering returns at once, and registering the same pull request twice keeps one watch. Watches live and die with this session.",
    promptSnippet: prWatchToolSystemPromptContribution.snippet,
    promptGuidelines: [...prWatchToolSystemPromptContribution.guidelines],
    parameters: prWatchSchema,
    execute(_toolCallId, params): Promise<AgentToolResult<PrWatchToolDetails>> {
      return Effect.runPromise(
        Effect.sync(() => {
          const text =
            params.action === "list"
              ? describeList(service)
              : params.action === "stop"
                ? describeStop(service, params)
                : describeWatch(service, params);
          return {
            content: [{ type: "text" as const, text }],
            details: {
              action: params.action,
              watching: service.snapshot().entries.map((entry) => prWatchKey(entry.target)),
            },
          };
        }),
      );
    },
  };
}
