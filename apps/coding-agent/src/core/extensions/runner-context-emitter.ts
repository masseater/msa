import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import type { BuildSystemPromptOptions } from "../system-prompt.ts";
import { buildSystemPrompt, normalizeBuildSystemPromptOptions } from "../system-prompt.ts";
import { HandlerInvoker } from "./runner-invoker.ts";
import { restoreSystemMessages, sameMessages } from "./runner-support.ts";
import type { BeforeAgentStartCombinedResult, BeforeAgentStartTrigger } from "./runner-types.ts";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  BeforeProviderHeadersEvent,
  BeforeProviderRequestEvent,
  ContextEvent,
  ContextEventResult,
  ContextWithSystemEvent,
  ExtensionContext,
  InputEvent,
  InputEventResult,
  InputSource,
  ResourcesDiscoverEvent,
  ResourcesDiscoverResult,
} from "./types.ts";

export interface DiscoveredPath {
  path: string;
  extensionPath: string;
}

export interface DiscoveredResources {
  skillPaths: DiscoveredPath[];
  promptPaths: DiscoveredPath[];
  themePaths: DiscoveredPath[];
}

const REMOVED_SYSTEM_MESSAGE =
  "Handler removed the leading system message; the request has no prompt or initial tool declarations. Keep it at index 0 or replace a dropped prefix with getCurrentSystemMessage().";

export class ContextEmitter extends HandlerInvoker {
  emitContext(messages: agentTypes.AgentMessage[]) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let currentMessages = structuredClone(messages);
      for (const { ext, handler } of this.slots("context")) {
        const visibleMessages = currentMessages.filter((message) => message.role !== "system");
        const visibleSnapshot = visibleMessages.slice();
        const event: ContextEvent = { messages: visibleMessages, type: "context" };
        const outcome = yield* this.invoke({ ctx, event, eventType: "context", ext, handler });
        if (!outcome.ok) continue;
        const returned =
          (outcome.value as ContextEventResult | undefined)?.messages ??
          (sameMessages(visibleMessages, visibleSnapshot) ? undefined : visibleMessages);
        if (returned === undefined) continue;
        currentMessages = restoreSystemMessages(currentMessages, visibleSnapshot, returned);
      }
      return yield* this.emitContextWithSystem(currentMessages, ctx);
    });
  }

  private emitContextWithSystem(messages: agentTypes.AgentMessage[], ctx: ExtensionContext) {
    return Effect.gen({ self: this }, function* () {
      let currentMessages = messages;
      for (const { ext, handler } of this.slots("context_with_system")) {
        const hadLeadingSystemMessage = currentMessages[0]?.role === "system";
        const event: ContextWithSystemEvent = {
          messages: currentMessages,
          type: "context_with_system",
        };
        const outcome = yield* this.invoke({
          ctx,
          event,
          eventType: "context_with_system",
          ext,
          handler,
        });
        if (!outcome.ok) continue;
        currentMessages =
          (outcome.value as ContextEventResult | undefined)?.messages ?? currentMessages;
        if (hadLeadingSystemMessage && currentMessages[0]?.role !== "system") {
          this.host.emitError({
            error: REMOVED_SYSTEM_MESSAGE,
            event: "context_with_system",
            extensionPath: ext.path,
          });
        }
      }
      return currentMessages;
    });
  }

  emitBeforeProviderRequest(payload: unknown) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let currentPayload = payload;
      for (const { ext, handler } of this.slots("before_provider_request")) {
        const event: BeforeProviderRequestEvent = {
          payload: currentPayload,
          type: "before_provider_request",
        };
        const outcome = yield* this.invoke({
          ctx,
          event,
          eventType: "before_provider_request",
          ext,
          handler,
        });
        if (outcome.ok && outcome.value !== undefined) currentPayload = outcome.value;
      }
      return currentPayload;
    });
  }

  emitBeforeProviderHeaders(headers: aiTypes.ProviderHeaders) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      for (const { ext, handler } of this.slots("before_provider_headers")) {
        const event: BeforeProviderHeadersEvent = { headers, type: "before_provider_headers" };
        yield* this.invoke({ ctx, event, eventType: "before_provider_headers", ext, handler });
      }
      return headers;
    });
  }

  emitBeforeAgentStart(
    trigger: BeforeAgentStartTrigger,
    systemPromptOptions: BuildSystemPromptOptions,
  ) {
    return Effect.gen({ self: this }, function* () {
      const currentOptions = normalizeBuildSystemPromptOptions(systemPromptOptions);
      const renderCurrentSystemPrompt = (): string => buildSystemPrompt(currentOptions);
      const ctx = Object.defineProperties(
        {},
        Object.getOwnPropertyDescriptors(this.host.createContext()),
      ) as ExtensionContext;
      ctx.getSystemPrompt = () => {
        this.host.assertActive();
        return renderCurrentSystemPrompt();
      };
      const messages: NonNullable<BeforeAgentStartEventResult["message"]>[] = [];
      for (const { ext, handler } of this.slots("before_agent_start")) {
        const event: BeforeAgentStartEvent = {
          ...trigger,
          get systemPrompt() {
            return renderCurrentSystemPrompt();
          },
          systemPromptOptions: currentOptions,
          type: "before_agent_start",
        };
        const outcome = yield* this.invoke({
          ctx,
          event,
          eventType: "before_agent_start",
          ext,
          handler,
        });
        const result =
          outcome.ok && typeof outcome.value === "object" && outcome.value !== null
            ? (outcome.value as BeforeAgentStartEventResult)
            : undefined;
        if (result?.message !== undefined) messages.push(result.message);
        if (result?.systemPrompt !== undefined) {
          currentOptions.forceSystemPrompt = result.systemPrompt;
        }
      }
      const combined: BeforeAgentStartCombinedResult = {
        messages,
        systemPromptOptions: currentOptions,
      };
      return combined;
    });
  }

  emitResourcesDiscover(cwd: string, reason: ResourcesDiscoverEvent["reason"]) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      const found: DiscoveredResources = { promptPaths: [], skillPaths: [], themePaths: [] };
      for (const { ext, handler } of this.slots("resources_discover")) {
        const event: ResourcesDiscoverEvent = { cwd, reason, type: "resources_discover" };
        const outcome = yield* this.invoke({
          ctx,
          event,
          eventType: "resources_discover",
          ext,
          handler,
        });
        if (!outcome.ok) continue;
        const result = outcome.value as ResourcesDiscoverResult | undefined;
        const tag = (paths: string[] | undefined) =>
          (paths ?? []).map((path) => ({ extensionPath: ext.path, path }));
        found.skillPaths.push(...tag(result?.skillPaths));
        found.promptPaths.push(...tag(result?.promptPaths));
        found.themePaths.push(...tag(result?.themePaths));
      }
      return found;
    });
  }

  emitInput(
    text: string,
    images: aiTypes.ImageContent[] | undefined,
    source: InputSource,
    streamingBehavior?: "steer" | "followUp",
  ) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let currentText = text;
      let currentImages = images;
      for (const { ext, handler } of this.slots("input")) {
        const event: InputEvent = {
          images: currentImages,
          source,
          streamingBehavior,
          text: currentText,
          type: "input",
        };
        const outcome = yield* this.invoke({ ctx, event, eventType: "input", ext, handler });
        if (!outcome.ok) continue;
        const result = outcome.value as InputEventResult | undefined;
        if (result?.action === "handled") return result;
        if (result?.action === "transform") {
          currentText = result.text;
          currentImages = result.images ?? currentImages;
        }
      }
      const final: InputEventResult =
        currentText !== text || currentImages !== images
          ? { action: "transform", images: currentImages, text: currentText }
          : { action: "continue" };
      return final;
    });
  }
}
