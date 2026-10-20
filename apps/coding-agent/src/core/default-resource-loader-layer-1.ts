import type themeTypes from "../modes/interactive/theme/theme.types.ts";
import DefaultResourceLoaderLayer0 from "./default-resource-loader-layer-0.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import type sourceInfoTypes from "./source-info.types.ts";

export default abstract class DefaultResourceLoaderLayer1 extends DefaultResourceLoaderLayer0 {
  themes!: themeTypes.Theme[];
  protected themeDiagnostics!: diagnosticsTypes.ResourceDiagnostic[];
  agentsFiles!: Array<{ path: string; content: string }>;
  systemPrompt?: string | undefined;
  protected systemPromptSourcePath?: string | undefined;
  appendSystemPrompt!: string[];
  protected appendSystemPromptSourcePaths!: string[];
  protected lastSkillPaths!: string[];
  protected extensionSkillSourceInfos!: Map<string, sourceInfoTypes.SourceInfo>;
  protected extensionPromptSourceInfos!: Map<string, sourceInfoTypes.SourceInfo>;
  protected extensionThemeSourceInfos!: Map<string, sourceInfoTypes.SourceInfo>;
  protected resourceMetadataByPath!: Map<string, packageManagerTypes.PathMetadata>;
  protected lastPromptPaths!: string[];
  protected lastThemePaths!: string[];
  protected loaded!: boolean;
}
