import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import authGuidance from "../auth-guidance.ts";
import awaitingModule from "../awaiting.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import type messagesTypes from "../messages.types.ts";
import platform from "../platform.ts";
import promptTemplates from "../prompt-templates.ts";

const { nowMs } = platform;
const { awaited, awaitingWith, performed } = awaitingModule;
const { formatNoModelSelectedMessage } = authGuidance;
const { expandPromptTemplate } = promptTemplates;

export default class SessionPrompting {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  pendingNextTurnMessages: messagesTypes.CustomMessage[] = [];

  pendingCustomMessages: messagesTypes.CustomMessage[] = [];

  private appendCustomMessage(appMessage: messagesTypes.CustomMessage): void {
    this.session.sessionManager.appendCustomMessageEntry(
      appMessage.customType,
      appMessage.content,
      appMessage.display,
      appMessage.details,
    );
    this.session.context.transcript.refreshFinalizedContext();
    this.session.emit({ message: appMessage, type: "message_start" });
    this.session.emit({ message: appMessage, type: "message_end" });
  }

  flushPendingCustomMessages(): void {
    if (this.pendingCustomMessages.length === 0) return;

    const pending = this.pendingCustomMessages;
    this.pendingCustomMessages = [];
    for (const appMessage of pending) {
      this.appendCustomMessage(appMessage);
    }
  }

  runInputHandlers(
    text: string,
    images: compatTypes.ImageContent[] | undefined,
    source: extensionsTypes.InputSource,
    streamingBehavior?: "steer" | "followUp",
  ): Effect.Effect<{ text: string; images: compatTypes.ImageContent[] | undefined } | undefined> {
    return awaitingWith(function* () {
      if (!this.session.extensions.binding.extensionRunnerInternal.hasHandlers("input")) {
        return { images, text };
      }

      const inputResult = yield* awaited(
        this.session.extensions.binding.extensionRunnerInternal.emitInput(
          text,
          images,
          source,
          streamingBehavior,
        ),
      );
      if (inputResult.action === "handled") {
        return undefined;
      }
      if (inputResult.action === "transform") {
        return { images: inputResult.images ?? images, text: inputResult.text };
      }
      return { images, text };
    }, this);
  }

  sendCustomMessage<T = unknown>(
    message: Pick<messagesTypes.CustomMessage<T>, "customType" | "content" | "display" | "details">,
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const appMessage = {
          content: message.content ?? [],
          customType: message.customType,
          details: message.details,
          display: message.display,
          role: "custom" as const,
          timestamp: nowMs(),
        } satisfies messagesTypes.CustomMessage<T>;
        if (options?.deliverAs === "nextTurn") {
          this.pendingNextTurnMessages.push(appMessage);
        } else if (this.session.isStreaming && options?.triggerTurn !== false) {
          if (options?.deliverAs === "followUp") {
            this.session.agent.followUp(appMessage);
          } else {
            this.session.agent.steer(appMessage);
          }
        } else if (options?.triggerTurn === true) {
          if (this.session.run.lifecycle.isEmittingAgentSettled) {
            this.session.run.lifecycle.deferredSettledActions.push(() =>
              Effect.runPromise(
                awaitingWith(function* () {
                  return yield* awaited(this.sendCustomMessage(message, options));
                }, this),
              ),
            );
            return;
          }
          yield* performed(
            this.session.run.lifecycle.startRun({ message: appMessage, messageType: "custom" }),
          );
        } else if (this.session.isStreaming) {
          this.pendingCustomMessages.push(appMessage);
        } else {
          this.appendCustomMessage(appMessage);
        }
      }, this),
    );
  }

  private expandPromptText(text: string, options?: agentSessionTypes.PromptOptions): string {
    if (!(options?.expandPromptTemplates ?? true)) return text;
    return expandPromptTemplate(this.session.commands.slash.expandSkillCommand(text), [
      ...this.session.promptTemplates,
    ]);
  }

  prompt(text: string, options?: agentSessionTypes.PromptOptions): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (this.session.run.lifecycle.isEmittingAgentSettled) {
          this.session.run.lifecycle.deferredSettledActions.push(() => this.prompt(text, options));
          return;
        }
        if (yield* performed(this.session.commands.dispatch.runPromptCommand(text, options)))
          return;
        if (this.session.compaction.manual.compactionAbortController !== undefined) {
          throw new Error(
            "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.",
          );
        }
        const processedInput = yield* performed(
          this.runInputHandlers(
            text,
            options?.images,
            options?.source ?? "interactive",
            this.session.isStreaming ? options?.streamingBehavior : undefined,
          ),
        );
        if (processedInput === undefined) {
          options?.preflightResult?.("handled");
          return;
        }
        const { text: currentText, images: currentImages } = processedInput;
        const expandedText = this.expandPromptText(currentText, options);
        if (this.session.isStreaming) {
          yield* performed(
            this.session.run.queue.queueWhileStreaming(expandedText, currentImages, options),
          );
          return;
        }
        const model = this.session.model;
        if (model === undefined) throw new Error(formatNoModelSelectedMessage());
        yield* performed(this.session.models.auth.ensurePromptAuth(model));
        yield* performed(
          this.session.run.lifecycle.startRun(
            { images: currentImages, messageType: "user", prompt: expandedText },
            () => options?.preflightResult?.("started"),
            options?.mode,
          ),
        );
      }, this),
    );
  }

  sendUserMessage(
    content: string | (compatTypes.TextContent | compatTypes.ImageContent)[],
    options?: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean },
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        let text: string;
        let images: compatTypes.ImageContent[] | undefined;

        if (typeof content === "string") {
          text = content;
        } else {
          const textParts: string[] = [];
          images = [];
          for (const part of content) {
            if (part.type === "text") {
              textParts.push(part.text);
            } else {
              images.push(part);
            }
          }
          text = textParts.join("\n");
          if (images.length === 0) images = undefined;
        }

        yield* awaited(
          this.prompt(text, {
            expandPromptTemplates: options?.expandPromptTemplates ?? false,
            images,
            source: "extension",
            streamingBehavior: options?.deliverAs,
          }),
        );
      }, this),
    );
  }
}
