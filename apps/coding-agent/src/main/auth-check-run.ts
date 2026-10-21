import type argsTypes from "../cli/args.types.ts";
import authCheck from "../cli/auth-check.ts";
import type authCheckTypes from "../cli/auth-check.types.ts";
import authCommand from "../cli/auth-command.ts";
import type authCommandTypes from "../cli/auth-command.types.ts";
import AuthStorage from "../core/auth-storage.ts";
import awaitingModule from "../core/awaiting.ts";
import ReadOnlyAuthStorage from "../core/read-only-auth-storage.ts";

const { getProviderCredential, checkProviderAuth, createAuthCheckModelRuntime } = authCheck;
const { validateAuthCommandArgs } = authCommand;
const { awaited } = awaitingModule;

function* checkAuthAndPrint(parsed: argsTypes.Args, command: authCommandTypes.AuthCommand) {
  const requestedAuth = validateAuthCommandArgs(parsed, command.kind);
  let result: authCheckTypes.AuthCheckResult;
  let credential: string | undefined;
  try {
    const credentials = command.noRefresh ? new ReadOnlyAuthStorage() : AuthStorage.create();
    const modelRuntime = yield* awaited(createAuthCheckModelRuntime(credentials));
    result = yield* awaited(
      checkProviderAuth(parsed, modelRuntime, { refresh: !command.noRefresh }),
    );
    if (command.credentials && result.status === "ready") {
      credential = yield* awaited(
        getProviderCredential(result.provider, modelRuntime, credentials, {
          refresh: !command.noRefresh,
        }),
      );
      if (credential === undefined || credential === "") {
        result = {
          provider: result.provider,
          reason: "credential_not_available",
          status: "not_ready",
        };
      }
    }
  } catch {
    result = {
      provider: requestedAuth.provider ?? requestedAuth.model!,
      reason: "invalid_state",
      status: "invalid",
    };
  }
  const output = command.json
    ? JSON.stringify({
        ...result,
        ...(credential !== undefined && credential !== "" ? { credentials: credential } : {}),
      })
    : (credential ?? result.status);
  process.stdout.write(`${output}\n`);
  process.exitCode = result.status === "ready" ? 0 : result.status === "not_ready" ? 1 : 2;
}

const authCheckRun = { checkAuthAndPrint };

export default authCheckRun;
