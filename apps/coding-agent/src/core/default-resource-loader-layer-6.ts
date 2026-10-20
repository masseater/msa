import DefaultResourceLoaderLayer5 from "./default-resource-loader-layer-5.ts";
import type diagnosticsTypes from "./diagnostics.ts";
import type packageManagerTypes from "./package-manager.types.ts";
import promptTemplates from "./prompt-templates.ts";
import type promptTemplatesTypes from "./prompt-templates.types.ts";
import type resourceLoaderTypes from "./resource-loader.types.ts";
import skillsModule from "./skills.ts";
import type skillsTypes from "./skills.types.ts";
import sourceInfoModule from "./source-info.ts";

const { createSourceInfo } = sourceInfoModule;
const { loadSkills } = skillsModule;
const { loadPromptTemplates } = promptTemplates;

export default abstract class DefaultResourceLoaderLayer6 extends DefaultResourceLoaderLayer5 {
  extendResources(paths: resourceLoaderTypes.ResourceExtensionPaths): void {
    const skillPaths = this.normalizeExtensionPaths(paths.skillPaths ?? []);
    const promptPaths = this.normalizeExtensionPaths(paths.promptPaths ?? []);
    const themePaths = this.normalizeExtensionPaths(paths.themePaths ?? []);

    for (const entry of skillPaths) {
      this.extensionSkillSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
    }
    for (const entry of promptPaths) {
      this.extensionPromptSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
    }
    for (const entry of themePaths) {
      this.extensionThemeSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
    }

    if (skillPaths.length > 0) {
      this.lastSkillPaths = this.mergePaths(
        this.lastSkillPaths,
        skillPaths.map((entry) => entry.path),
      );
      this.updateSkillsFromPaths(this.lastSkillPaths, this.resourceMetadataByPath);
    }

    if (promptPaths.length > 0) {
      this.lastPromptPaths = this.mergePaths(
        this.lastPromptPaths,
        promptPaths.map((entry) => entry.path),
      );
      this.updatePromptsFromPaths(this.lastPromptPaths, this.resourceMetadataByPath);
    }

    if (themePaths.length > 0) {
      this.lastThemePaths = this.mergePaths(
        this.lastThemePaths,
        themePaths.map((entry) => entry.path),
      );
      this.updateThemesFromPaths(this.lastThemePaths, this.resourceMetadataByPath);
    }
  }

  protected updateSkillsFromPaths(
    skillPaths: string[],
    metadataByPath?: Map<string, packageManagerTypes.PathMetadata>,
  ): void {
    let skillsResult: {
      skills: skillsTypes.Skill[];
      diagnostics: diagnosticsTypes.ResourceDiagnostic[];
    };
    if (this.noSkills && skillPaths.length === 0) {
      skillsResult = { diagnostics: [], skills: [] };
    } else {
      skillsResult = loadSkills({
        agentDir: this.agentDir,
        cwd: this.cwd,
        includeDefaults: false,
        skillPaths,
      });
    }
    const resolvedSkills =
      this.skillsOverride === undefined ? skillsResult : this.skillsOverride(skillsResult);
    this.skills = resolvedSkills.skills.map((skill) => ({
      ...skill,
      sourceInfo:
        this.findSourceInfoForPath(
          skill.filePath,
          this.extensionSkillSourceInfos,
          metadataByPath,
        ) ??
        skill.sourceInfo ??
        this.getDefaultSourceInfoForPath(skill.filePath),
    }));
    this.skillDiagnostics = resolvedSkills.diagnostics;
  }

  protected updatePromptsFromPaths(
    promptPaths: string[],
    metadataByPath?: Map<string, packageManagerTypes.PathMetadata>,
  ): void {
    let promptsResult: {
      prompts: promptTemplatesTypes.PromptTemplate[];
      diagnostics: diagnosticsTypes.ResourceDiagnostic[];
    };
    if (this.noPromptTemplates && promptPaths.length === 0) {
      promptsResult = { diagnostics: [], prompts: [] };
    } else {
      const loaded = loadPromptTemplates({
        agentDir: this.agentDir,
        cwd: this.cwd,
        includeDefaults: false,
        promptPaths,
      });
      const deduped = this.dedupePrompts(loaded.templates);
      promptsResult = {
        diagnostics: [...loaded.diagnostics, ...deduped.diagnostics],
        prompts: deduped.prompts,
      };
    }
    const resolvedPrompts =
      this.promptsOverride === undefined ? promptsResult : this.promptsOverride(promptsResult);
    this.prompts = resolvedPrompts.prompts.map((prompt) => ({
      ...prompt,
      sourceInfo:
        this.findSourceInfoForPath(
          prompt.filePath,
          this.extensionPromptSourceInfos,
          metadataByPath,
        ) ??
        prompt.sourceInfo ??
        this.getDefaultSourceInfoForPath(prompt.filePath),
    }));
    this.promptDiagnostics = resolvedPrompts.diagnostics;
  }
}
