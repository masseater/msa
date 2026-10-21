import agentSessionHelpers from "../core/agent-session-helpers.ts";
import DefaultResourceLoader from "../core/default-resource-loader.ts";
import resourceLoader from "../core/resource-loader.ts";
import skillDirectory from "../core/skill-directory.ts";
import skillsModule from "../core/skills.ts";
import sourceInfo from "../core/source-info.ts";
import frontmatter from "../utils/frontmatter.ts";

const resourcesKit: {
  readonly DefaultResourceLoader: typeof DefaultResourceLoader;
  readonly createSyntheticSourceInfo: typeof sourceInfo.createSyntheticSourceInfo;
  readonly formatSkillsForPrompt: typeof skillsModule.formatSkillsForPrompt;
  readonly loadProjectContextFiles: typeof resourceLoader.loadProjectContextFiles;
  readonly loadSkills: typeof skillsModule.loadSkills;
  readonly loadSkillsFromDir: typeof skillDirectory.loadSkillsFromDir;
  readonly parseFrontmatter: typeof frontmatter.parseFrontmatter;
  readonly parseSkillBlock: typeof agentSessionHelpers.parseSkillBlock;
  readonly stripFrontmatter: typeof frontmatter.stripFrontmatter;
} = {
  DefaultResourceLoader,
  createSyntheticSourceInfo: sourceInfo.createSyntheticSourceInfo,
  formatSkillsForPrompt: skillsModule.formatSkillsForPrompt,
  loadProjectContextFiles: resourceLoader.loadProjectContextFiles,
  loadSkills: skillsModule.loadSkills,
  loadSkillsFromDir: skillDirectory.loadSkillsFromDir,
  parseFrontmatter: frontmatter.parseFrontmatter,
  parseSkillBlock: agentSessionHelpers.parseSkillBlock,
  stripFrontmatter: frontmatter.stripFrontmatter,
};

export default resourcesKit;
