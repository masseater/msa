import type promptTemplatesTypes from "../../core/prompt-templates.types.ts";
import type resourceLoaderTypes from "../../core/resource-loader.types.ts";
import type sourceInfoTypes from "../../core/source-info.types.ts";

declare namespace loadedResourcesTypes {
  type ResourceItem = { path: string; sourceInfo?: sourceInfoTypes.SourceInfo };

  type LoadedResourcesSource = {
    resourceLoader: Pick<
      resourceLoaderTypes.ResourceLoader,
      | "getSkills"
      | "getPrompts"
      | "getThemes"
      | "getExtensions"
      | "getSystemPromptSource"
      | "getAppendSystemPromptSources"
      | "getAgentsFiles"
    >;
    promptTemplates: readonly promptTemplatesTypes.PromptTemplate[];
    extensionRunnerDiagnostics: readonly resourceLoaderTypes.ResourceDiagnostic[];
  };

  type LoadedResourcesOptions = {
    cwd: string;
    expanded: boolean;
    showListing: boolean;
    showDiagnostics: boolean;
    extensions?: readonly ResourceItem[] | undefined;
  };
}

export type { loadedResourcesTypes as default };
