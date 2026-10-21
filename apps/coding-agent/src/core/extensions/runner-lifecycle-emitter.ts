import type agentTypes from "@msa/agent-core/index.types";
import { Effect, Result } from "effect";

import errors from "../../utils/errors.ts";
import type cacheWarmerTypes from "../cache-warmer.types.ts";
import platform from "../platform/index.ts";
import HandlerInvoker from "./runner-invoker.ts";
import runnerSupport from "./runner-support.ts";
import type runnerTypesTypes from "./runner-types.ts";
import type extensionsTypesTypes from "./types.types.ts";
const { fromPromise } = platform;
const { toErrorMessage } = errors;
const { isUserBashEventResult } = runnerSupport;

const isSessionBeforeEvent = (
  event: runnerTypesTypes.RunnerEmitEvent,
): event is runnerTypesTypes.SessionBeforeEvent =>
  event.type === "session_before_switch" ||
  event.type === "session_before_fork" ||
  event.type === "session_before_compact" ||
  event.type === "session_before_tree";

type BuildBoundaryContext = (
  entries: extensionsTypesTypes.SessionBoundaryDraft[],
) =>
  | extensionsTypesTypes.BoundaryContextPreview
  | Promise<extensionsTypesTypes.BoundaryContextPreview>;

export default class LifecycleEmitter {
  private readonly host: ConstructorParameters<typeof HandlerInvoker>[0];
  private readonly handlers: HandlerInvoker;

  constructor(host: ConstructorParameters<typeof HandlerInvoker>[0]) {
    this.host = host;
    this.handlers = new HandlerInvoker(host);
  }

  emitBoundary(baseEvent: runnerTypesTypes.BoundaryBaseEvent, buildContext: BuildBoundaryContext) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let entries: extensionsTypesTypes.SessionBoundaryDraft[] = [];
      let shouldContinue = false;
      let context = yield* fromPromise(() => buildContext(entries));
      let valid = true;
      for (const { ext, handler } of this.handlers.slots(baseEvent.type)) {
        const event = { ...baseEvent, context, continue: shouldContinue, entries } as
          | extensionsTypesTypes.TurnEndEvent
          | extensionsTypesTypes.AgentBeforeSettleEvent;
        const outcome = yield* this.handlers.invoke({
          ctx,
          event,
          eventType: baseEvent.type,
          ext,
          handler,
        });
        if (outcome.ok) {
          const handlerResult = outcome.value as extensionsTypesTypes.BoundaryResult | undefined;
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
          this.handlers.reportError(
            ext.path,
            baseEvent.type,
            rebuilt.failure.cause,
            `Invalid boundary entries: ${toErrorMessage(rebuilt.failure.cause)}`,
          );
        }
      }
      const result: runnerTypesTypes.BoundaryDispatchResult = valid
        ? { context, continue: shouldContinue, entries, valid: true }
        : { context, continue: false, entries: [], valid: false };
      return result;
    });
  }

  emit<TEvent extends runnerTypesTypes.RunnerEmitEvent>(event: TEvent) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let result: runnerTypesTypes.SessionBeforeEventResult | undefined;
      for (const { ext, handler } of this.handlers.slots(event.type)) {
        const outcome = yield* this.handlers.invoke({
          ctx,
          event,
          eventType: event.type,
          ext,
          handler,
        });
        if (outcome.ok && isSessionBeforeEvent(event) && outcome.value !== undefined) {
          result = outcome.value as runnerTypesTypes.SessionBeforeEventResult;
          if (result.cancel === true) return result as runnerTypesTypes.RunnerEmitResult<TEvent>;
        }
      }
      return result as runnerTypesTypes.RunnerEmitResult<TEvent>;
    });
  }

  emitCacheWarmingDecision(event: extensionsTypesTypes.CacheWarmingDecisionEvent) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let action: cacheWarmerTypes.CacheWarmingAction = event.action;
      for (const { ext, handler } of this.handlers.slots(event.type)) {
        const outcome = yield* this.handlers.invoke({
          ctx,
          event,
          eventType: event.type,
          ext,
          handler,
        });
        const result = outcome.ok
          ? (outcome.value as extensionsTypesTypes.CacheWarmingDecisionEventResult | undefined)
          : undefined;
        if (result?.action !== undefined) action = result.action;
      }
      return action;
    });
  }

  emitMessageEnd(event: extensionsTypesTypes.MessageEndEvent) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let currentMessage = event.message;
      let modified = false;
      for (const { ext, handler } of this.handlers.slots("message_end")) {
        const currentEvent: extensionsTypesTypes.MessageEndEvent = {
          ...event,
          message: currentMessage,
        };
        const outcome = yield* this.handlers.invoke({
          ctx,
          event: currentEvent,
          eventType: "message_end",
          ext,
          handler,
        });
        const handlerResult = outcome.ok
          ? (outcome.value as extensionsTypesTypes.MessageEndEventResult | undefined)
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

  emitToolCall(event: extensionsTypesTypes.ToolCallEvent) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let result: extensionsTypesTypes.ToolCallEventResult | undefined;
      for (const { handler } of this.handlers.slots("tool_call")) {
        const handlerResult = yield* fromPromise(() => handler(event, ctx));
        if (typeof handlerResult === "object" && handlerResult !== null) {
          result = handlerResult as extensionsTypesTypes.ToolCallEventResult;
          if (result.block === true) return result;
        }
      }
      return result;
    });
  }

  emitUserBash(event: extensionsTypesTypes.UserBashEvent) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      for (const { ext, handler } of this.handlers.slots("user_bash")) {
        const outcome = yield* fromPromise(() => handler(event, ctx)).pipe(Effect.result);
        if (Result.isFailure(outcome)) {
          this.handlers.reportError(ext.path, "user_bash", outcome.failure.cause);
          return yield* outcome.failure;
        }
        const handlerResult = outcome.success;
        if (handlerResult === undefined) continue;
        if (!isUserBashEventResult(handlerResult)) {
          const invalid = new Error(
            "Invalid user_bash handler result: return undefined for local execution or exactly one valid { operations } or { result } object",
          );
          this.handlers.reportError(ext.path, "user_bash", invalid);
          return yield* Effect.die(invalid);
        }
        const valid: extensionsTypesTypes.UserBashEventResult = handlerResult;
        return valid;
      }
      return undefined;
    });
  }

  emitToolResult(event: extensionsTypesTypes.ToolResultEvent) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      const currentEvent: extensionsTypesTypes.ToolResultEvent = { ...event };
      let modified = false;
      for (const { ext, handler } of this.handlers.slots("tool_result")) {
        const outcome = yield* this.handlers.invoke({
          ctx,
          event: currentEvent,
          eventType: "tool_result",
          ext,
          handler,
        });
        const handlerResult = outcome.ok
          ? (outcome.value as extensionsTypesTypes.ToolResultEventResult | undefined)
          : undefined;
        if (handlerResult === undefined) continue;
        modified = applyToolResult(currentEvent, handlerResult) || modified;
      }
      if (!modified) return undefined;
      const merged: extensionsTypesTypes.ToolResultEventResult = {
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

function applyToolResult(
  target: extensionsTypesTypes.ToolResultEvent,
  result: extensionsTypesTypes.ToolResultEventResult,
): boolean {
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
