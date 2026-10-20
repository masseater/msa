import { type ExecOptions, execCommand } from "../exec.ts";
import type { ApiScope, HandlerFn } from "./loader-scope.ts";
import type { ExtensionAPI } from "./types.ts";

export const eventMembers = ({
  extension,
  runtime,
  eventBus,
  assertActive,
  isLoading,
  loadingUnsubscribers,
}: ApiScope) => ({
  events: {
    emit(channel: string, data: unknown) {
      assertActive();
      eventBus.emit(channel, data);
    },
    on(channel: string, handler: (data: unknown) => void) {
      assertActive();
      const unsubscribe = runtime.trackEventBusSubscription(eventBus.on(channel, handler));
      if (isLoading()) loadingUnsubscribers.push(unsubscribe);
      return unsubscribe;
    },
  },

  on(event: string, handler: HandlerFn): () => void {
    assertActive();
    const registeredHandler: HandlerFn = (...args) => handler(...args);
    const list = extension.handlers.get(event) ?? [];
    list.push(registeredHandler);
    extension.handlers.set(event, list);

    return () => {
      const handlers = extension.handlers.get(event);
      if (handlers === undefined) return;
      const handlerIndex = handlers.indexOf(registeredHandler);
      if (handlerIndex === -1) return;
      handlers.splice(handlerIndex, 1);
      if (handlers.length === 0) extension.handlers.delete(event);
    };
  },
});

export const messageMembers = ({ runtime, assertActive }: ApiScope): Partial<ExtensionAPI> => ({
  appendEntry(customType: string, data?: unknown): void {
    assertActive();
    runtime.appendEntry(customType, data);
  },

  getSessionName(): string | undefined {
    assertActive();
    return runtime.getSessionName();
  },

  sendMessage(message, options): void {
    assertActive();
    runtime.sendMessage(message, options);
  },

  sendUserMessage(content, options): void {
    assertActive();
    runtime.sendUserMessage(content, options);
  },

  setLabel(entryId: string, label: string | undefined): void {
    assertActive();
    runtime.setLabel(entryId, label);
  },

  setSessionName(name: string): void {
    assertActive();
    runtime.setSessionName(name);
  },
});

export const stateMembers = ({ runtime, cwd, assertActive }: ApiScope): Partial<ExtensionAPI> => ({
  exec(command: string, args: string[], options?: ExecOptions) {
    assertActive();
    return execCommand(command, args, options?.cwd ?? cwd, options);
  },

  getActiveTools(): string[] {
    assertActive();
    return runtime.getActiveTools();
  },

  getAllTools() {
    assertActive();
    return runtime.getAllTools();
  },

  getCommands() {
    assertActive();
    return runtime.getCommands();
  },

  getSettings() {
    assertActive();
    return runtime.getSettings();
  },

  getThinkingLevel() {
    assertActive();
    return runtime.getThinkingLevel();
  },

  setActiveTools(toolNames: string[]): void {
    assertActive();
    runtime.setActiveTools(toolNames);
  },

  setModel(model) {
    assertActive();
    return runtime.setModel(model);
  },

  setThinkingLevel(level) {
    assertActive();
    runtime.setThinkingLevel(level);
  },
});
