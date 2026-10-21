import type tuiTypes from "@msa/tui/index.types";

import type themeTypes from "../../modes/interactive/theme/theme.types.ts";
import type messagesTypes from "../messages.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";
import type sourceInfoTypes from "../source-info.types.ts";
import type typesContextTypes from "./types-context.ts";

declare namespace typesRenderTypes {
  interface MessageRenderOptions {
    expanded: boolean;
    outputPad: number;
  }

  interface MarkdownTransformContext {
    messageType: "user" | "assistant" | "assistant-thinking";
    isStreaming: boolean;
    availableWidth: number;
  }

  type MarkdownTransformer = (markdown: string, context: MarkdownTransformContext) => string;

  interface EntryRenderOptions {
    expanded: boolean;
  }

  type MessageRenderer<T = unknown> = (
    message: messagesTypes.CustomMessage<T>,
    options: MessageRenderOptions,
    theme: themeTypes.Theme,
  ) => tuiTypes.Component | undefined;

  type EntryRenderer<T = unknown> = (
    entry: sessionManagerTypes.CustomEntry<T>,
    options: EntryRenderOptions,
    theme: themeTypes.Theme,
  ) => tuiTypes.Component | undefined;

  interface RegisteredCommand {
    name: string;
    sourceInfo: sourceInfoTypes.SourceInfo;
    description?: string;
    getArgumentCompletions?: (
      argumentPrefix: string,
    ) => tuiTypes.AutocompleteItem[] | null | Promise<tuiTypes.AutocompleteItem[] | null>;
    handler: (args: string, ctx: typesContextTypes.ExtensionCommandContext) => Promise<void>;
  }

  interface ResolvedCommand extends RegisteredCommand {
    invocationName: string;
  }

  type ExtensionHandler<E, R = undefined> = (
    event: E,
    ctx: typesContextTypes.ExtensionContext,
  ) => Promise<R | void> | R | void;
}

export type { typesRenderTypes as default };
