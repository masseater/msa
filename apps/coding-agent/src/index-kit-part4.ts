import skillDirectory from "./core/skill-directory.ts";
import skillsModule from "./core/skills.ts";
import sourceInfo from "./core/source-info.ts";
import editDiff from "./core/tools/edit-diff.ts";
import renderUtils from "./core/tools/render-utils.ts";
import mcpExtension from "./extensions/mcp/extension.ts";
import toolSearchExtension from "./extensions/tool-search/extension.ts";
import themeModule from "./modes/interactive/theme/theme.ts";
import imageResize from "./utils/image-resize.ts";
import mime from "./utils/mime.ts";

const { createMcpExtension: createMcpExtensionModule } = mcpExtension;
const { createToolSearchExtension: createToolSearchExtensionModule } = toolSearchExtension;

const indexKitPart4 = {
  createMcpExtension: createMcpExtensionModule,
  createSyntheticSourceInfo: sourceInfo.createSyntheticSourceInfo,
  createToolSearchExtension: createToolSearchExtensionModule,
  detectSupportedImageMimeTypeFromFile: mime.detectSupportedImageMimeTypeFromFile,
  formatDimensionNote: imageResize.formatDimensionNote,
  formatReadLineRange: renderUtils.formatReadLineRange,
  formatSkillsForPrompt: skillsModule.formatSkillsForPrompt,
  generateDiffString: editDiff.generateDiffString,
  generateUnifiedPatch: editDiff.generateUnifiedPatch,
  getLanguageFromPath: themeModule.getLanguageFromPath,
  getMarkdownTheme: themeModule.getMarkdownTheme,
  getSelectListTheme: themeModule.getSelectListTheme,
  getSettingsListTheme: themeModule.getSettingsListTheme,
  highlightCode: themeModule.highlightCode,
  initTheme: themeModule.initTheme,
  loadSkills: skillsModule.loadSkills,
  loadSkillsFromDir: skillDirectory.loadSkillsFromDir,
  resizeImage: imageResize.resizeImage,
};

export default indexKitPart4;
