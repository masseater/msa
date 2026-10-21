import type argsTypes from "../cli/args.types.ts";
import awaitingModule from "../core/awaiting.ts";
import ProjectTrustStore from "../core/project-trust-store.ts";
import trustManager from "../core/trust-manager.ts";

const { awaited } = awaitingModule;
const { hasTrustRequiringProjectResources } = trustManager;

function* sessionTrust(parsed: argsTypes.Args, agentDir: string, sessionCwd: string) {
  const trustStore = new ProjectTrustStore(agentDir);
  const autoTrustOnReloadCwd =
    parsed.projectTrustOverride === undefined &&
    !(yield* awaited(hasTrustRequiringProjectResources(sessionCwd)))
      ? sessionCwd
      : undefined;
  return { autoTrustOnReloadCwd, trustStore };
}

const sessionTrustModule = { sessionTrust };

export default sessionTrustModule;
