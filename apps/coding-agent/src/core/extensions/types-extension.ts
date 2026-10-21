import type tuiTypes from "@msa/tui/index.types";

import type externalServicesTypes from "../external-services.types.ts";
import type sourceInfoTypes from "../source-info.types.ts";
import type typesContextActionsTypes from "./types-context-actions.ts";
import type typesProviderTypes from "./types-provider.ts";
import type typesRenderTypes from "./types-render.ts";
import type typesRuntimeTypes from "./types-runtime.ts";
import type typesToolsTypes from "./types-tools.types.ts";

declare namespace typesExtensionTypes {
  interface Extension {
    path: string;
    resolvedPath: string;
    hidden?: boolean;
    replaceable?: boolean;
    sourceInfo: sourceInfoTypes.SourceInfo;
    handlers: Map<string, typesRuntimeTypes.HandlerFn[]>;
    tools: Map<string, typesProviderTypes.RegisteredTool>;
    messageRenderers: Map<string, typesRenderTypes.MessageRenderer>;
    toolRenderers?: typesToolsTypes.ToolRendererResolver[];
    markdownTransformer?: typesRenderTypes.MarkdownTransformer;
    externalServices?: externalServicesTypes.ExternalService[];
    entryRenderers?: Map<string, typesRenderTypes.EntryRenderer>;
    commands: Map<string, typesRenderTypes.RegisteredCommand>;
    flags: Map<string, typesProviderTypes.ExtensionFlag>;
    shortcuts: Map<tuiTypes.KeyId, typesProviderTypes.ExtensionShortcut>;
  }

  interface LoadExtensionsResult {
    extensions: Extension[];
    errors: Array<{ path: string; error: string }>;
    warnings?: Array<{ path: string; warning: string }>;
    runtime: typesContextActionsTypes.ExtensionRuntime;
  }

  interface ExtensionError {
    extensionPath: string;
    event: string;
    error: string;
    stack?: string | undefined;
  }
}

export type { typesExtensionTypes as default };
