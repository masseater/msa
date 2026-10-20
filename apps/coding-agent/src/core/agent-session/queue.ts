import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import awaitingModule from "../awaiting.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import platform from "../platform.ts";
import promptTemplatesModule from "../prompt-templates.ts";

const { nowMs } = platform;
const { contentText } = ai;
const { awaitingWith, performed } = awaitingModule;
const { expandPromptTemplate } = promptTemplatesModule;

export default class SessionQueue {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  private steeringMessages: string[] = [];

  private followUpMessages: string[] = [];

  get steeringMode(): "all" | "one-at-a-time" {
    return this.session.agent.steeringMode;
  }

  get followUpMode(): "all" | "one-at-a-time" {
    return this.session.agent.followUpMode;
  }

  get pendingMessageCount(): number {
    return this.steeringMessages.length + this.followUpMessages.length;
  }

  getSteeringMessages(): readonly string[] {
    return this.steeringMessages;
  }

  getFollowUpMessages(): readonly string[] {
    return this.followUpMessages;
  }

  syncQueueModesFromSettings(): void {
    this.session.agent.steeringMode = this.session.settingsManager.getSteeringMode();
    this.session.agent.followUpMode = this.session.settingsManager.getFollowUpMode();
  }

  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this.session.agent.steeringMode = mode;
    this.session.settingsManager.setSteeringMode(mode);
  }

  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this.session.agent.followUpMode = mode;
    this.session.settingsManager.setFollowUpMode(mode);
  }

  private emitQueueUpdate(): void {
    this.session.emit({
      followUp: [...this.followUpMessages],
      steering: [...this.steeringMessages],
      type: "queue_update",
    });
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    const steering = [...this.steeringMessages];
    const followUp = [...this.followUpMessages];
    this.steeringMessages = [];
    this.followUpMessages = [];
    this.session.agent.clearAllQueues();
    this.emitQueueUpdate();
    return { followUp, steering };
  }

  flushQueue(): number {
    const count = this.session.agent.flushQueuedMessages();
    if (count === 0) return 0;
    this.steeringMessages = [...this.steeringMessages, ...this.followUpMessages];
    this.followUpMessages = [];
    this.emitQueueUpdate();
    return count;
  }

  dequeueDeliveredUserMessage(message: agentTypes.AgentMessage): void {
    this.session.compaction.overflow.overflowRecoveryAttempted = false;
    const messageText = contentText((message as compatTypes.UserMessage).content, "");
    if (messageText === "") return;
    const steeringIndex = this.steeringMessages.indexOf(messageText);
    if (steeringIndex !== -1) {
      this.steeringMessages.splice(steeringIndex, 1);
      this.emitQueueUpdate();
      return;
    }
    const followUpIndex = this.followUpMessages.indexOf(messageText);
    if (followUpIndex === -1) return;
    this.followUpMessages.splice(followUpIndex, 1);
    this.emitQueueUpdate();
  }

  private queueSteer(text: string, images?: compatTypes.ImageContent[]): Effect.Effect<void> {
    return Effect.sync(() => {
      this.steeringMessages.push(text);
      this.emitQueueUpdate();
      const content: (compatTypes.TextContent | compatTypes.ImageContent)[] = [
        { text, type: "text" },
      ];
      if (images !== undefined) {
        content.push(...images);
      }
      this.session.agent.steer({
        content,
        role: "user",
        timestamp: nowMs(),
      });
    });
  }

  private queueFollowUp(text: string, images?: compatTypes.ImageContent[]): Effect.Effect<void> {
    return Effect.sync(() => {
      this.followUpMessages.push(text);
      this.emitQueueUpdate();
      const content: (compatTypes.TextContent | compatTypes.ImageContent)[] = [
        { text, type: "text" },
      ];
      if (images !== undefined) {
        content.push(...images);
      }
      this.session.agent.followUp({ content, role: "user", timestamp: nowMs() });
    });
  }

  queueWhileStreaming(
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

  private queueUserInput(
    text: string,
    images: compatTypes.ImageContent[] | undefined,
    behavior: "steer" | "followUp",
    source: extensionsTypes.InputSource,
  ): Effect.Effect<agentSessionTypes.QueuedInputDisposition> {
    return awaitingWith(function* () {
      if (text.startsWith("/")) {
        this.session.commands.dispatch.throwIfExtensionCommand(text);
      }

      const processedInput = yield* performed(
        this.session.run.prompting.runInputHandlers(
          text,
          images,
          source,
          this.session.isStreaming ? behavior : undefined,
        ),
      );
      if (processedInput === undefined) return "handled";

      let expandedText = this.session.commands.slash.expandSkillCommand(processedInput.text);
      expandedText = expandPromptTemplate(expandedText, [...this.session.promptTemplates]);

      if (behavior === "steer") {
        yield* performed(this.queueSteer(expandedText, processedInput.images));
      } else {
        yield* performed(this.queueFollowUp(expandedText, processedInput.images));
      }
      return "queued";
    }, this);
  }

  steer(
    text: string,
    images?: compatTypes.ImageContent[],
    options?: { source?: extensionsTypes.InputSource },
  ): Promise<agentSessionTypes.QueuedInputDisposition> {
    return Effect.runPromise(
      awaitingWith(function* () {
        return yield* performed(
          this.queueUserInput(text, images, "steer", options?.source ?? "interactive"),
        );
      }, this),
    );
  }

  followUp(
    text: string,
    images?: compatTypes.ImageContent[],
    options?: { source?: extensionsTypes.InputSource },
  ): Promise<agentSessionTypes.QueuedInputDisposition> {
    return Effect.runPromise(
      awaitingWith(function* () {
        return yield* performed(
          this.queueUserInput(text, images, "followUp", options?.source ?? "interactive"),
        );
      }, this),
    );
  }
}
