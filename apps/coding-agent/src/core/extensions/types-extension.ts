import type tuiTypes from "@msa/tui/index.types";

import type { ExternalService } from "../external-services.ts";
import type { SourceInfo } from "../source-info.ts";
import type { ExtensionRuntime } from "./types-context-actions.ts";
import type { ExtensionFlag, ExtensionShortcut, RegisteredTool } from "./types-provider.ts";
import type {
  EntryRenderer,
  MarkdownTransformer,
  MessageRenderer,
  RegisteredCommand,
} from "./types-render.ts";
import type { HandlerFn } from "./types-runtime.ts";
import type { ToolRendererResolver } from "./types-tools.ts";

export interface Extension {
  path: string;
  resolvedPath: string;
  hidden?: boolean;
  replaceable?: boolean;
  sourceInfo: SourceInfo;
  handlers: Map<string, HandlerFn[]>;
  tools: Map<string, RegisteredTool>;
  messageRenderers: Map<string, MessageRenderer>;
  toolRenderers?: ToolRendererResolver[];
  markdownTransformer?: MarkdownTransformer;
  externalServices?: ExternalService[];
  entryRenderers?: Map<string, EntryRenderer>;
  commands: Map<string, RegisteredCommand>;
  flags: Map<string, ExtensionFlag>;
  shortcuts: Map<tuiTypes.KeyId, ExtensionShortcut>;
}

export interface LoadExtensionsResult {
  extensions: Extension[];
  errors: Array<{ path: string; error: string }>;
  warnings?: Array<{ path: string; warning: string }>;
  runtime: ExtensionRuntime;
}

export interface ExtensionError {
  extensionPath: string;
  event: string;
  error: string;
  stack?: string | undefined;
}
