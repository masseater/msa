import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";
import { isNullish } from "effect/Predicate";

import toolResultImages from "../utils/tool-result-images.ts";
import AgentSessionLayer11 from "./agent-session-layer-11.ts";
import type agentSessionTypes from "./agent-session.types.ts";
import authGuidance from "./auth-guidance.ts";
import awaitingModule from "./awaiting.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { normalizeToolResultImages } = toolResultImages;
const { formatNoApiKeyFoundMessage } = authGuidance;

export default abstract class AgentSessionLayer12 extends AgentSessionLayer11 {
  protected installAgentToolHooks(): void {
    this.agent.beforeToolCall = (context) => Effect.runPromise(this.beforeToolCall(context));
    this.agent.afterToolCall = (context) => Effect.runPromise(this.afterToolCall(context));
  }

  protected beforeToolCall(
    { toolCall, args }: agentTypes.BeforeToolCallContext,
    parentToolCallId?: string,
  ): Effect.Effect<agentTypes.BeforeToolCallResult | undefined> {
    return awaitingWith(function* () {
      const runner = this.extensionRunnerInternal;
      if (!runner.hasHandlers("tool_call")) {
        return undefined;
      }

      try {
        return yield* awaited(
          runner.emitToolCall({
            input: args as Record<string, unknown>,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            type: "tool_call",
            ...(parentToolCallId !== undefined && parentToolCallId !== ""
              ? { parentToolCallId }
              : {}),
          }),
        );
      } catch (err) {
        if (err instanceof Error) {
          throw err;
        }
        throw new Error(`Extension failed, blocking execution: ${String(err)}`, { cause: err });
      }
    }, this);
  }

  protected afterToolCall(
    context: agentTypes.AfterToolCallContext,
    parentToolCallId?: string,
  ): Effect.Effect<agentTypes.AfterToolCallResult | undefined> {
    const { result, isError } = context;
    return awaitingWith(function* () {
      const hookResult = yield* awaited(this.emitToolResultHook(context, parentToolCallId));
      const content = hookResult?.content ?? result.content ?? [];
      const resizeOptions = this.limitsModel()?.inputLimits?.images?.resize;
      const normalizedContent = yield* awaited(
        normalizeToolResultImages(content, {
          autoResizeImages: this.settingsManager.getImageAutoResize(),
          ...(resizeOptions === undefined ? {} : { resizeOptions }),
        }),
      );

      if (hookResult === undefined && normalizedContent === content) {
        return undefined;
      }

      const details = hookResult?.details;
      const structuredContent =
        hookResult === undefined ? result.structuredContent : hookResult.structuredContent;
      const usage = hookResult?.usage;
      return {
        content: normalizedContent,
        ...(details === undefined ? {} : { details }),
        ...(structuredContent === undefined ? {} : { structuredContent }),
        isError: hookResult?.isError ?? isError,
        ...(usage === undefined ? {} : { usage }),
      };
    }, this);
  }

  protected prepareProjectedRequest(
    previousPrepareRequest: agentTypes.Agent["prepareRequest"],
    request: Parameters<NonNullable<agentTypes.Agent["prepareRequest"]>>[0],
    signal: AbortSignal | undefined,
  ) {
    return Effect.runPromise(
      awaitingWith(function* () {
        const projection = this.sessionManager.buildSessionProjection();
        const canonicalContext = {
          ...request.context,
          messages: projection.messages,
          tools: this.agent.state.tools.slice(),
        };
        const previous = yield* awaited(
          previousPrepareRequest?.(
            {
              ...request,
              context: canonicalContext,
              model: this.agent.state.model,
              thinkingLevel: this.agent.state.thinkingLevel,
            },
            signal,
          ),
        );
        return { context: previous?.context ?? canonicalContext, previous, projection };
      }, this),
    );
  }

  protected applyMessageEndReplacement(message: agentTypes.AgentMessage) {
    return awaitingWith(function* () {
      const replacement = yield* awaited(
        this.extensionRunnerInternal.emitMessageEnd({ message, type: "message_end" }),
      );
      if (replacement === undefined) return;
      const normalized =
        (replacement.role === "user" ||
          replacement.role === "assistant" ||
          replacement.role === "toolResult" ||
          replacement.role === "custom") &&
        isNullish(replacement.content)
          ? ({ ...replacement, content: [] } as agentTypes.AgentMessage)
          : replacement;
      this.replaceMessageInPlace(message, normalized);
    }, this);
  }

  protected runBeforeSettleBoundary(): Effect.Effect<boolean> {
    return awaitingWith(function* () {
      if (!this.extensionRunnerInternal.hasHandlers("agent_before_settle"))
        return this.agent.hasQueuedMessages();
      this.isBeforeSettle = true;
      this.abortDuringBeforeSettle = false;
      try {
        const result = yield* awaited(
          this.extensionRunnerInternal.emitBoundary(
            { outcome: this.lastActivityOutcome, type: "agent_before_settle" },
            (entries) => this.buildBoundaryContext(entries, "agent_before_settle"),
          ),
        );
        this.commitBoundaryDrafts(result.entries);
        this.flushPendingCustomMessages();
        const finalContext = this.buildBoundaryContext([], "agent_before_settle");
        if (this.abortDuringBeforeSettle) return false;
        const shouldContinue = result.continue || this.agent.hasQueuedMessages();
        if (shouldContinue && !finalContext.canContinue) {
          if (result.continue) this.reportInvalidBoundaryContinuation("agent_before_settle");
          return false;
        }
        return shouldContinue;
      } finally {
        this.isBeforeSettle = false;
      }
    }, this);
  }

  protected queueWhileStreaming(
    text: string,
    images: compatTypes.ImageContent[] | undefined,
    options: agentSessionTypes.PromptOptions | undefined,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (options?.mode === "ask") {
        throw new Error("Cannot ask while the agent is running. Wait for the turn to finish.");
      }
      if (options?.streamingBehavior === undefined) {
        throw new Error(
          "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
        );
      }
      if (options.streamingBehavior === "followUp")
        yield* performed(this.queueFollowUp(text, images));
      else yield* performed(this.queueSteer(text, images));
      options.preflightResult?.("queued");
    }, this);
  }

  protected ensurePromptAuth(model: compatTypes.Model<any>): Effect.Effect<void> {
    return awaitingWith(function* () {
      const hasConfiguredAuth =
        this.modelRuntimeInternal.hasConfiguredAuth(model.provider) ||
        (yield* awaited(this.modelRuntimeInternal.checkAuth(model.provider))) !== undefined;
      if (hasConfiguredAuth) return;
      if (this.modelRuntimeInternal.isUsingOAuth(model.provider)) {
        throw new Error(
          `Authentication failed for "${model.provider}". ` +
            `Credentials may have expired or network is unavailable. ` +
            `Run '/login ${model.provider}' to re-authenticate.`,
        );
      }
      throw new Error(formatNoApiKeyFoundMessage(model.provider));
    }, this);
  }

  bindExtensions(bindings: agentSessionTypes.ExtensionBindings): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (bindings.uiContext !== undefined) {
          this.extensionUIContext = bindings.uiContext;
        }
        if (bindings.mode !== undefined) {
          this.extensionMode = bindings.mode;
        }
        if (bindings.commandContextActions !== undefined) {
          this.extensionCommandContextActions = bindings.commandContextActions;
        }
        if (bindings.abortHandler !== undefined) {
          this.extensionAbortHandler = bindings.abortHandler;
        }
        if (bindings.shutdownHandler !== undefined) {
          this.extensionShutdownHandler = bindings.shutdownHandler;
        }
        if (bindings.onError !== undefined) {
          this.extensionErrorListener = bindings.onError;
        }

        this.applyExtensionBindings(this.extensionRunnerInternal);
        yield* awaited(this.extensionRunnerInternal.emit(this.sessionStartEvent));
        this.extensionRunnerInternal.reportUnhandledMcpServers();
        yield* performed(
          this.extendResourcesFromExtensions(
            this.sessionStartEvent.reason === "reload" ? "reload" : "startup",
          ),
        );
      }, this),
    );
  }

  protected extendResourcesFromExtensions(reason: "startup" | "reload"): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (!this.extensionRunnerInternal.hasHandlers("resources_discover")) {
        return;
      }

      const { skillPaths, promptPaths, themePaths } = yield* awaited(
        this.extensionRunnerInternal.emitResourcesDiscover(this.cwd, reason),
      );

      if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) {
        return;
      }

      const extensionPaths: resourceLoaderTypes.ResourceExtensionPaths = {
        promptPaths: this.buildExtensionResourcePaths(promptPaths),
        skillPaths: this.buildExtensionResourcePaths(skillPaths),
        themePaths: this.buildExtensionResourcePaths(themePaths),
      };

      this.resourceLoaderInternal.extendResources(extensionPaths);
      this.rebuildSystemPrompt(this.getActiveToolNames());
    }, this);
  }
}
