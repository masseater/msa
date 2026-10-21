import args from "./cli/args.ts";
import agentSessionHelpers from "./core/agent-session-helpers.ts";
import authStorageSupport from "./core/auth-storage-support.ts";
import cliModelFlag from "./core/cli-model.ts";
import resourceLoader from "./core/resource-loader.ts";
import runtimeModelScope from "./core/runtime-model-scope.ts";
import trustManager from "./core/trust-manager.ts";
import mainModule from "./main.ts";
import frontmatter from "./utils/frontmatter.ts";
import shell from "./utils/shell.ts";

const indexKitPart5 = {
  getPowerShellConfig: shell.getPowerShellConfig,
  getShellConfig: shell.getShellConfig,
  hasTrustRequiringProjectResources: trustManager.hasTrustRequiringProjectResources,
  loadProjectContextFiles: resourceLoader.loadProjectContextFiles,
  main: mainModule.main,
  parseArgs: args.parseArgs,
  parseFrontmatter: frontmatter.parseFrontmatter,
  parseSkillBlock: agentSessionHelpers.parseSkillBlock,
  readStoredCredential: authStorageSupport.readStoredCredential,
  resolveCliModel: cliModelFlag.resolveCliModel,
  resolveModelScopeWithDiagnostics: runtimeModelScope.resolveModelScopeWithDiagnostics,
  stripFrontmatter: frontmatter.stripFrontmatter,
};

export default indexKitPart5;
