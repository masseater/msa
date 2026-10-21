import editDiff from "../core/tools/edit-diff.ts";
import tools from "../core/tools/index.ts";
import renderUtils from "../core/tools/render-utils.ts";

const toolsKit: {
  readonly DEFAULT_MAX_BYTES: typeof tools.DEFAULT_MAX_BYTES;
  readonly DEFAULT_MAX_LINES: typeof tools.DEFAULT_MAX_LINES;
  readonly createBashToolDefinition: typeof tools.createBashToolDefinition;
  readonly createEditToolDefinition: typeof tools.createEditToolDefinition;
  readonly createFindToolDefinition: typeof tools.createFindToolDefinition;
  readonly createGrepToolDefinition: typeof tools.createGrepToolDefinition;
  readonly createLocalBashOperations: typeof tools.createLocalBashOperations;
  readonly createLocalPowerShellOperations: typeof tools.createLocalPowerShellOperations;
  readonly createLsToolDefinition: typeof tools.createLsToolDefinition;
  readonly createPowerShellToolDefinition: typeof tools.createPowerShellToolDefinition;
  readonly createReadToolDefinition: typeof tools.createReadToolDefinition;
  readonly createWriteToolDefinition: typeof tools.createWriteToolDefinition;
  readonly formatReadLineRange: typeof renderUtils.formatReadLineRange;
  readonly formatSize: typeof tools.formatSize;
  readonly generateDiffString: typeof editDiff.generateDiffString;
  readonly generateUnifiedPatch: typeof editDiff.generateUnifiedPatch;
  readonly truncateHead: typeof tools.truncateHead;
  readonly truncateLine: typeof tools.truncateLine;
  readonly truncateTail: typeof tools.truncateTail;
  readonly withFileMutationQueue: typeof tools.withFileMutationQueue;
} = {
  DEFAULT_MAX_BYTES: tools.DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES: tools.DEFAULT_MAX_LINES,
  createBashToolDefinition: tools.createBashToolDefinition,
  createEditToolDefinition: tools.createEditToolDefinition,
  createFindToolDefinition: tools.createFindToolDefinition,
  createGrepToolDefinition: tools.createGrepToolDefinition,
  createLocalBashOperations: tools.createLocalBashOperations,
  createLocalPowerShellOperations: tools.createLocalPowerShellOperations,
  createLsToolDefinition: tools.createLsToolDefinition,
  createPowerShellToolDefinition: tools.createPowerShellToolDefinition,
  createReadToolDefinition: tools.createReadToolDefinition,
  createWriteToolDefinition: tools.createWriteToolDefinition,
  formatReadLineRange: renderUtils.formatReadLineRange,
  formatSize: tools.formatSize,
  generateDiffString: editDiff.generateDiffString,
  generateUnifiedPatch: editDiff.generateUnifiedPatch,
  truncateHead: tools.truncateHead,
  truncateLine: tools.truncateLine,
  truncateTail: tools.truncateTail,
  withFileMutationQueue: tools.withFileMutationQueue,
};

export default toolsKit;
