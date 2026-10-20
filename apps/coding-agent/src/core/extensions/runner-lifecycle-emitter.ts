import type agentTypes from "@msa/agent-core/index.types";
import { Effect, Result } from "effect";

import { toErrorMessage } from "../../utils/errors.ts";
import type { CacheWarmingAction } from "../cache-warmer.ts";
import { fromPromise } from "../platform/index.ts";
import { HandlerInvoker } from "./runner-invoker.ts";
import { isUserBashEventResult } from "./runner-support.ts";
import type {
  BoundaryBaseEvent,
  BoundaryDispatchResult,
  RunnerEmitEvent,
  RunnerEmitResult,
  SessionBeforeEvent,
  SessionBeforeEventResult,
} from "./runner-types.ts";
import type {
  AgentBeforeSettleEvent,
  BoundaryContextPreview,
  BoundaryResult,
  CacheWarmingDecisionEvent,
  CacheWarmingDecisionEventResult,
  MessageEndEvent,
  MessageEndEventResult,
  SessionBoundaryDraft,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent,
  ToolResultEventResult,
  TurnEndEvent,
  UserBashEvent,
  UserBashEventResult,
} from "./types.ts";

const isSessionBeforeEvent = (event: RunnerEmitEvent): event is SessionBeforeEvent =>
  event.type === "session_before_switch" ||
  event.type === "session_before_fork" ||
  event.type === "session_before_compact" ||
  event.type === "session_before_tree";

type BuildBoundaryContext = (
  entries: SessionBoundaryDraft[],
) => BoundaryContextPreview | Promise<BoundaryContextPreview>;

export class LifecycleEmitter extends HandlerInvoker {
  emitBoundary(baseEvent: BoundaryBaseEvent, buildContext: BuildBoundaryContext) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let entries: SessionBoundaryDraft[] = [];
      let shouldContinue = false;
      let context = yield* fromPromise(() => buildContext(entries));
      let valid = true;
      for (const { ext, handler } of this.slots(baseEvent.type)) {
        const event = { ...baseEvent, context, continue: shouldContinue, entries } as
          | TurnEndEvent
          | AgentBeforeSettleEvent;
        const outcome = yield* this.invoke({ ctx, event, eventType: baseEvent.type, ext, handler });
        if (outcome.ok) {
          const handlerResult = outcome.value as BoundaryResult | undefined;
          if (handlerResult?.entries !== undefined) entries = handlerResult.entries;
          if (handlerResult?.continue !== undefined) shouldContinue = handlerResult.continue;
        }
        const draftEntries = entries;
        const rebuilt = yield* fromPromise(() => buildContext(draftEntries)).pipe(Effect.result);
        if (Result.isSuccess(rebuilt)) {
          context = rebuilt.success;
          valid = true;
        } else {
          valid = false;
          this.reportError(
            ext.path,
            baseEvent.type,
            rebuilt.failure.cause,
            `Invalid boundary entries: ${toErrorMessage(rebuilt.failure.cause)}`,
          );
        }
      }
      const result: BoundaryDispatchResult = valid
        ? { context, continue: shouldContinue, entries, valid: true }
        : { context, continue: false, entries: [], valid: false };
      return result;
    });
  }

  emit<TEvent extends RunnerEmitEvent>(event: TEvent) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let result: SessionBeforeEventResult | undefined;
      for (const { ext, handler } of this.slots(event.type)) {
        const outcome = yield* this.invoke({ ctx, event, eventType: event.type, ext, handler });
        if (outcome.ok && isSessionBeforeEvent(event) && outcome.value !== undefined) {
          result = outcome.value as SessionBeforeEventResult;
          if (result.cancel === true) return result as RunnerEmitResult<TEvent>;
        }
      }
      return result as RunnerEmitResult<TEvent>;
    });
  }

  emitCacheWarmingDecision(event: CacheWarmingDecisionEvent) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let action: CacheWarmingAction = event.action;
      for (const { ext, handler } of this.slots(event.type)) {
        const outcome = yield* this.invoke({ ctx, event, eventType: event.type, ext, handler });
        const result = outcome.ok
          ? (outcome.value as CacheWarmingDecisionEventResult | undefined)
          : undefined;
        if (result?.action !== undefined) action = result.action;
      }
      return action;
    });
  }

  emitMessageEnd(event: MessageEndEvent) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let currentMessage = event.message;
      let modified = false;
      for (const { ext, handler } of this.slots("message_end")) {
        const currentEvent: MessageEndEvent = { ...event, message: currentMessage };
        const outcome = yield* this.invoke({
          ctx,
          event: currentEvent,
          eventType: "message_end",
          ext,
          handler,
        });
        const handlerResult = outcome.ok
          ? (outcome.value as MessageEndEventResult | undefined)
          : undefined;
        if (handlerResult?.message === undefined) continue;
        if (handlerResult.message.role !== currentMessage.role) {
          this.host.emitError({
            error: "message_end handlers must return a message with the same role",
            event: "message_end",
            extensionPath: ext.path,
          });
          continue;
        }
        currentMessage = handlerResult.message;
        modified = true;
      }
      const message: agentTypes.AgentMessage | undefined = modified ? currentMessage : undefined;
      return message;
    });
  }

  emitToolCall(event: ToolCallEvent) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let result: ToolCallEventResult | undefined;
      for (const { handler } of this.slots("tool_call")) {
        const handlerResult = yield* fromPromise(() => handler(event, ctx));
        if (typeof handlerResult === "object" && handlerResult !== null) {
          result = handlerResult as ToolCallEventResult;
          if (result.block === true) return result;
        }
      }
      return result;
    });
  }

  emitUserBash(event: UserBashEvent) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      for (const { ext, handler } of this.slots("user_bash")) {
        const outcome = yield* fromPromise(() => handler(event, ctx)).pipe(Effect.result);
        if (Result.isFailure(outcome)) {
          this.reportError(ext.path, "user_bash", outcome.failure.cause);
          return yield* outcome.failure;
        }
        const handlerResult = outcome.success;
        if (handlerResult === undefined) continue;
        if (!isUserBashEventResult(handlerResult)) {
          const invalid = new Error(
            "Invalid user_bash handler result: return undefined for local execution or exactly one valid { operations } or { result } object",
          );
          this.reportError(ext.path, "user_bash", invalid);
          return yield* Effect.die(invalid);
        }
        const valid: UserBashEventResult = handlerResult;
        return valid;
      }
      return undefined;
    });
  }

  emitToolResult(event: ToolResultEvent) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      const currentEvent: ToolResultEvent = { ...event };
      let modified = false;
      for (const { ext, handler } of this.slots("tool_result")) {
        const outcome = yield* this.invoke({
          ctx,
          event: currentEvent,
          eventType: "tool_result",
          ext,
          handler,
        });
        const handlerResult = outcome.ok
          ? (outcome.value as ToolResultEventResult | undefined)
          : undefined;
        if (handlerResult === undefined) continue;
        modified = applyToolResult(currentEvent, handlerResult) || modified;
      }
      if (!modified) return undefined;
      const merged: ToolResultEventResult = {
        content: currentEvent.content,
        details: currentEvent.details,
        isError: currentEvent.isError,
        structuredContent: currentEvent.structuredContent,
        usage: currentEvent.usage,
      };
      return merged;
    });
  }
}

function applyToolResult(target: ToolResultEvent, result: ToolResultEventResult): boolean {
  let modified = false;
  if (result.content !== undefined) {
    target.content = result.content;
    if (result.structuredContent === undefined) delete target.structuredContent;
    modified = true;
  }
  if (result.details !== undefined) {
    target.details = result.details;
    modified = true;
  }
  if (result.structuredContent !== undefined) {
    target.structuredContent = result.structuredContent;
    modified = true;
  }
  if (result.isError !== undefined) {
    target.isError = result.isError;
    modified = true;
  }
  if (result.usage !== undefined) {
    target.usage = result.usage;
    modified = true;
  }
  return modified;
}
