import type resourceLoaderTypes from "../core/resource-loader.types.ts";
import type skillsTypes from "../core/skills.types.ts";

declare namespace codingAgentResourcesKitTypes {
  type ResourceCollision = resourceLoaderTypes.ResourceCollision;
  type ResourceDiagnostic = resourceLoaderTypes.ResourceDiagnostic;
  type ResourceLoader = resourceLoaderTypes.ResourceLoader;
  type DefaultResourceLoader = resourceLoaderTypes.DefaultResourceLoader;
  type LoadSkillsFromDirOptions = skillsTypes.LoadSkillsFromDirOptions;
  type LoadSkillsResult = skillsTypes.LoadSkillsResult;
  type Skill = skillsTypes.Skill;
  type SkillFrontmatter = skillsTypes.SkillFrontmatter;
}

export type { codingAgentResourcesKitTypes as default };
