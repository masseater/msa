import type defaultResourceLoaderInternalTypes from "../default-resource-loader-internal.types.ts";
import type DefaultResourceLoader from "../default-resource-loader.ts";
import type diagnosticsTypes from "../diagnostics.ts";
import type packageManagerTypes from "../package-manager.types.ts";
import type resourceLoaderTypes from "../resource-loader.types.ts";
import skillsModule from "../skills.ts";
import type skillsTypes from "../skills.types.ts";
import sourceInfoModule from "../source-info.ts";
import type sourceInfoTypes from "../source-info.types.ts";

const { loadSkills } = skillsModule;

const { createSourceInfo } = sourceInfoModule;

export default class SkillResources {
  private readonly owner: DefaultResourceLoader;

  constructor(owner: DefaultResourceLoader) {
    this.owner = owner;
  }

  additionalSkillPaths: string[] = [];

  noSkills = false;

  skillsOverride!: resourceLoaderTypes.DefaultResourceLoaderOptions["skillsOverride"];

  skills: skillsTypes.Skill[] = [];

  skillDiagnostics: diagnosticsTypes.ResourceDiagnostic[] = [];

  lastSkillPaths: string[] = [];

  extensionSkillSourceInfos = new Map<string, sourceInfoTypes.SourceInfo>();

  updateSkillsFromPaths(
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
        agentDir: this.owner.environment.agentDir,
        cwd: this.owner.environment.cwd,
        includeDefaults: false,
        skillPaths,
      });
    }
    const resolvedSkills =
      this.skillsOverride === undefined ? skillsResult : this.skillsOverride(skillsResult);
    this.skills = resolvedSkills.skills.map((skill) => ({
      ...skill,
      sourceInfo:
        this.owner.environment.paths.findSourceInfoForPath(
          skill.filePath,
          this.extensionSkillSourceInfos,
          metadataByPath,
        ) ??
        skill.sourceInfo ??
        this.owner.environment.paths.getDefaultSourceInfoForPath(skill.filePath),
    }));
    this.skillDiagnostics = resolvedSkills.diagnostics;
  }

  configure(options: resourceLoaderTypes.DefaultResourceLoaderOptions): void {
    this.additionalSkillPaths = options.additionalSkillPaths ?? [];
    this.noSkills = options.noSkills ?? false;
    this.skillsOverride = options.skillsOverride;
  }

  reload(plan: defaultResourceLoaderInternalTypes.ResourcePlan): void {
    const { paths } = this.owner.environment;
    const { cli, configured } = plan.skills;
    const skillPaths = this.noSkills
      ? paths.mergePaths(cli, this.additionalSkillPaths)
      : paths.mergePaths([...cli, ...configured], this.additionalSkillPaths);
    this.lastSkillPaths = skillPaths;
    this.updateSkillsFromPaths(skillPaths, plan.metadataByPath);
    for (const resolved of paths.missingPaths(this.additionalSkillPaths, true)) {
      if (this.skillDiagnostics.some((d) => d.path === resolved)) continue;
      this.skillDiagnostics.push({
        message: "Skill path does not exist",
        path: resolved,
        type: "error",
      });
    }
  }

  extend(entries: Array<{ path: string; metadata: packageManagerTypes.PathMetadata }>): void {
    for (const entry of entries) {
      this.extensionSkillSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
    }
    if (entries.length === 0) return;
    this.lastSkillPaths = this.owner.environment.paths.mergePaths(
      this.lastSkillPaths,
      entries.map((entry) => entry.path),
    );
    this.updateSkillsFromPaths(
      this.lastSkillPaths,
      this.owner.environment.paths.resourceMetadataByPath,
    );
  }
}
