import type { AgentMessage } from "@msa/agent-core";
import type { ImageContent, ProviderHeaders } from "@msa/ai";
import { Effect } from "effect";

import { buildSystemPrompt, normalizeBuildSystemPromptOptions } from "../system-prompt.ts";
import type { BuildSystemPromptOptions } from "../system-prompt.ts";
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

interface DiscoveredPath {
  path: string;
  extensionPath: string;
}

interface DiscoveredResources {
  skillPaths: DiscoveredPath[];
  promptPaths: DiscoveredPath[];
  themePaths: DiscoveredPath[];
}

const REMOVED_SYSTEM_MESSAGE =
  "Handler removed the leading system message; the request has no prompt or initial tool declarations. Keep it at index 0 or replace a dropped prefix with getCurrentSystemMessage().";

export class ContextEmitter extends HandlerInvoker {
  emitContext(messages: AgentMessage[]) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let currentMessages = structuredClone(messages);
      for (const { ext, handler } of this.slots("context")) {
        const visibleMessages = currentMessages.filter((message) => message.role !== "system");
        const visibleSnapshot = visibleMessages.slice();
        const event: ContextEvent = { type: "context", messages: visibleMessages };
        const outcome = yield* this.invoke({ ext, eventType: "context", handler, event, ctx });
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

  private emitContextWithSystem(messages: AgentMessage[], ctx: ExtensionContext) {
    return Effect.gen({ self: this }, function* () {
      let currentMessages = messages;
      for (const { ext, handler } of this.slots("context_with_system")) {
        const hadLeadingSystemMessage = currentMessages[0]?.role === "system";
        const event: ContextWithSystemEvent = {
          type: "context_with_system",
          messages: currentMessages,
        };
        const outcome = yield* this.invoke({
          ext,
          eventType: "context_with_system",
          handler,
          event,
          ctx,
        });
        if (!outcome.ok) continue;
        currentMessages =
          (outcome.value as ContextEventResult | undefined)?.messages ?? currentMessages;
        if (hadLeadingSystemMessage && currentMessages[0]?.role !== "system") {
          this.host.emitError({
            extensionPath: ext.path,
            event: "context_with_system",
            error: REMOVED_SYSTEM_MESSAGE,
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
          type: "before_provider_request",
          payload: currentPayload,
        };
        const outcome = yield* this.invoke({
          ext,
          eventType: "before_provider_request",
          handler,
          event,
          ctx,
        });
        if (outcome.ok && outcome.value !== undefined) currentPayload = outcome.value;
      }
      return currentPayload;
    });
  }

  emitBeforeProviderHeaders(headers: ProviderHeaders) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      for (const { ext, handler } of this.slots("before_provider_headers")) {
        const event: BeforeProviderHeadersEvent = { type: "before_provider_headers", headers };
        yield* this.invoke({ ext, eventType: "before_provider_headers", handler, event, ctx });
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
          type: "before_agent_start",
          get systemPrompt() {
            return renderCurrentSystemPrompt();
          },
          systemPromptOptions: currentOptions,
        };
        const outcome = yield* this.invoke({
          ext,
          eventType: "before_agent_start",
          handler,
          event,
          ctx,
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
      const found: DiscoveredResources = { skillPaths: [], promptPaths: [], themePaths: [] };
      for (const { ext, handler } of this.slots("resources_discover")) {
        const event: ResourcesDiscoverEvent = { type: "resources_discover", cwd, reason };
        const outcome = yield* this.invoke({
          ext,
          eventType: "resources_discover",
          handler,
          event,
          ctx,
        });
        if (!outcome.ok) continue;
        const result = outcome.value as ResourcesDiscoverResult | undefined;
        const tag = (paths: string[] | undefined) =>
          (paths ?? []).map((path) => ({ path, extensionPath: ext.path }));
        found.skillPaths.push(...tag(result?.skillPaths));
        found.promptPaths.push(...tag(result?.promptPaths));
        found.themePaths.push(...tag(result?.themePaths));
      }
      return found;
    });
  }

  emitInput(
    text: string,
    images: ImageContent[] | undefined,
    source: InputSource,
    streamingBehavior?: "steer" | "followUp",
  ) {
    return Effect.gen({ self: this }, function* () {
      const ctx = this.host.createContext();
      let currentText = text;
      let currentImages = images;
      for (const { ext, handler } of this.slots("input")) {
        const event: InputEvent = {
          type: "input",
          text: currentText,
          images: currentImages,
          source,
          streamingBehavior,
        };
        const outcome = yield* this.invoke({ ext, eventType: "input", handler, event, ctx });
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
          ? { action: "transform", text: currentText, images: currentImages }
          : { action: "continue" };
      return final;
    });
  }
}
