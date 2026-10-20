import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import messagesModule from "../messages.ts";
import platform from "../platform.ts";
import virtualModels from "../virtual-models.ts";
import type virtualModelsTypes from "../virtual-models.types.ts";

const { nowMs } = platform;
const { isVirtualModel, VIRTUAL_MODEL_STATE_ENTRY, getVirtualModelState } = virtualModels;
const { getCurrentSystemMessage } = ai;
const { awaited, awaitingWith, performed } = awaitingModule;
const { convertToLlm } = messagesModule;

export default class SessionRequestProjection {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  installHiddenDeclarationsProjection(): void {
    const previousTransformContext = this.session.agent.transformContext;
    this.session.agent.transformContext = (messages, signal) =>
      Effect.runPromise(
        awaitingWith(function* () {
          const transformed =
            previousTransformContext === undefined
              ? messages
              : yield* awaited(previousTransformContext(messages, signal));
          const hidden = this.session.tools.loadout.hiddenDeclarations;
          if (hidden.size === 0) return transformed;
          return transformed.map((message) => {
            if (
              message.role !== "system" ||
              (message.toolsAdded === undefined && message.toolsRemoved === undefined)
            )
              return message;
            const { toolsAdded, toolsRemoved, ...rest } = message;
            const added = toolsAdded?.filter((tool) => !hidden.has(tool.name)) ?? [];
            const removed = toolsRemoved?.filter((tool) => !hidden.has(tool.name)) ?? [];
            return Object.assign(
              {},
              rest,
              added.length > 0 ? { toolsAdded: added } : {},
              removed.length > 0 ? { toolsRemoved: removed } : {},
            );
          });
        }, this),
      );
  }

  private prepareProjectedRequest(
    previousPrepareRequest: agentTypes.Agent["prepareRequest"],
    request: Parameters<NonNullable<agentTypes.Agent["prepareRequest"]>>[0],
    signal: AbortSignal | undefined,
  ) {
    return Effect.runPromise(
      awaitingWith(function* () {
        const projection = this.session.sessionManager.buildSessionProjection();
        const canonicalContext = {
          ...request.context,
          messages: projection.messages,
          tools: this.session.agent.state.tools.slice(),
        };
        const previous = yield* awaited(
          previousPrepareRequest?.(
            {
              ...request,
              context: canonicalContext,
              model: this.session.agent.state.model,
              thinkingLevel: this.session.agent.state.thinkingLevel,
            },
            signal,
          ),
        );
        return { context: previous?.context ?? canonicalContext, previous, projection };
      }, this),
    );
  }

  installAgentForcedPromptProjection(): void {
    const previousTransformContext = this.session.agent.transformContext;
    this.session.agent.transformContext = (messages, signal) =>
      Effect.runPromise(
        awaitingWith(function* () {
          const transformed =
            previousTransformContext === undefined
              ? messages
              : yield* awaited(previousTransformContext(messages, signal));
          const forced = this.session.tools.prompt.runSystemPromptOptions?.forceSystemPrompt;
          if (forced === undefined) return transformed;
          const current = getCurrentSystemMessage(transformed);
          const head: compatTypes.SystemMessage = {
            content: forced,
            role: "system",
            timestamp: current?.timestamp ?? nowMs(),
            ...(current?.toolsAdded === undefined ? {} : { toolsAdded: current.toolsAdded }),
          };
          return [head, ...transformed.filter((message) => message.role !== "system")];
        }, this),
      );
  }

  private routeVirtualRequest(
    model: compatTypes.Model<any>,
    context: agentTypes.AgentContext,
    options: {
      failed: compatTypes.AssistantMessage | undefined;
      signal: AbortSignal | undefined;
      thinkingLevel: agentTypes.ThinkingLevel;
    },
  ) {
    return awaitingWith(function* () {
      const lastResponse = context.messages.findLastIndex(
        (message) => message.role === "assistant",
      );
      const userTurn = context.messages
        .slice(lastResponse + 1)
        .some((message) => message.role === "user");
      const state = getVirtualModelState(
        this.session.sessionManager.getBranch(),
        model.provider,
        model.id,
      );
      const reason = options.failed === undefined ? (userTurn ? "user" : "continuation") : "retry";
      const route = yield* awaited(
        this.session.models.selection.modelRuntimeInternal.resolveModel(
          model,
          convertToLlm(context.messages),
          {
            failed: options.failed,
            reason,
            signal: options.signal,
            state,
            thinkingLevel: options.thinkingLevel,
          },
        ),
      );
      if (route.state !== undefined && route.state !== state) {
        const data: virtualModelsTypes.VirtualModelStateData = {
          modelId: model.id,
          provider: model.provider,
          state: route.state,
        };
        const entry = this.session.sessionManager.getEntry(
          this.session.sessionManager.appendCustomEntry(VIRTUAL_MODEL_STATE_ENTRY, data),
        );
        if (entry !== undefined) this.session.emit({ entry, type: "entry_appended" });
      }
      return route;
    }, this);
  }

  installAgentRequestProjection(): void {
    const previousPrepareRequest = this.session.agent.prepareRequest;
    this.session.agent.prepareRequest = (request, signal) =>
      Effect.runPromise(this.projectRequest(previousPrepareRequest, request, signal));
  }

  private projectRequest(
    previousPrepareRequest: agentTypes.Agent["prepareRequest"],
    request: Parameters<NonNullable<agentTypes.Agent["prepareRequest"]>>[0],
    signal: AbortSignal | undefined,
  ) {
    return awaitingWith(function* () {
      const failed = this.session.run.lifecycle.failedResponse;
      this.session.run.lifecycle.failedResponse = undefined;
      const prepare = () => this.prepareProjectedRequest(previousPrepareRequest, request, signal);
      let { previous, context, projection } = yield* awaited(prepare());
      const model = previous?.model ?? this.session.agent.state.model;
      const thinkingLevel = previous?.thinkingLevel ?? this.session.agent.state.thinkingLevel;
      if (!isVirtualModel(model)) return { ...previous, context, model, thinkingLevel };
      const route = yield* performed(
        this.routeVirtualRequest(model, context, { failed, signal, thinkingLevel }),
      );
      if (this.session.compaction.auto.exceedsCompactionThreshold(route.model, projection)) {
        yield* awaited(this.session.compaction.auto.runAutoCompaction("threshold", false));
        ({ previous, context } = yield* awaited(prepare()));
      }
      return { ...previous, context, model: route.model, thinkingLevel: route.thinkingLevel };
    }, this);
  }

  installAgentNextTurnRefresh(): void {
    const previousPrepareNextTurnWithContext =
      this.session.agent.prepareNextTurnWithContext ??
      (this.session.agent.prepareNextTurn === undefined
        ? undefined
        : (_turn: agentTypes.PrepareNextTurnContext, signal?: AbortSignal) =>
            Effect.runPromise(
              awaitingWith(function* () {
                return yield* awaited(this.session.agent.prepareNextTurn?.(signal));
              }, this),
            ));
    this.session.agent.prepareNextTurnWithContext = (turn, signal) =>
      Effect.runPromise(
        awaitingWith(function* () {
          const context = yield* performed(
            this.session.compaction.auto.compactBeforeNextAssistantResponse(turn.context),
          );
          const previousSnapshot = yield* awaited(
            previousPrepareNextTurnWithContext?.({ ...turn, context }, signal),
          );
          const nextContext = previousSnapshot?.context ?? context;
          const options = this.session.tools.prompt.nextTurnPromptOptions();
          const updateMessage = this.session.tools.loadout.preparePromptAndToolLoadout(
            options,
            nextContext.messages,
          );
          this.session.tools.prompt.runSystemPromptOptions = options;

          return {
            ...previousSnapshot,
            context: {
              ...nextContext,
              tools: this.session.agent.state.tools.slice(),
            },
            ...(updateMessage === undefined
              ? {}
              : { messages: [...(previousSnapshot?.messages ?? []), updateMessage] }),
            model: this.session.agent.state.model,
            thinkingLevel: this.session.agent.state.thinkingLevel,
          };
        }, this),
      );
  }
}
