import type tuiTypes from "@msa/tui/index.types";

import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { CustomMessage } from "../messages.ts";
import type { CustomEntry } from "../session-manager.ts";
import type { SourceInfo } from "../source-info.ts";
import type { ExtensionCommandContext, ExtensionContext } from "./types-context.ts";

export interface MessageRenderOptions {
  expanded: boolean;
  outputPad: number;
}

export interface MarkdownTransformContext {
  messageType: "user" | "assistant" | "assistant-thinking";
  isStreaming: boolean;
  availableWidth: number;
}

export type MarkdownTransformer = (markdown: string, context: MarkdownTransformContext) => string;

export interface EntryRenderOptions {
  expanded: boolean;
}

export type MessageRenderer<T = unknown> = (
  message: CustomMessage<T>,
  options: MessageRenderOptions,
  theme: Theme,
) => tuiTypes.Component | undefined;

export type EntryRenderer<T = unknown> = (
  entry: CustomEntry<T>,
  options: EntryRenderOptions,
  theme: Theme,
) => tuiTypes.Component | undefined;

export interface RegisteredCommand {
  name: string;
  sourceInfo: SourceInfo;
  description?: string;
  getArgumentCompletions?: (
    argumentPrefix: string,
  ) => tuiTypes.AutocompleteItem[] | null | Promise<tuiTypes.AutocompleteItem[] | null>;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

export interface ResolvedCommand extends RegisteredCommand {
  invocationName: string;
}

export type ExtensionHandler<E, R = undefined> = (
  event: E,
  ctx: ExtensionContext,
) => Promise<R | void> | R | void;
