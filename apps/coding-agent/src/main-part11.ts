import { Effect } from "effect";

import startupUi from "./cli/startup-ui.ts";
import awaitingModule from "./core/awaiting.ts";
import sessionCwdModule from "./core/session-cwd.ts";
import type sessionCwdTypes from "./core/session-cwd.types.ts";
import type settingsManagerTypes from "./core/settings-manager.types.ts";
import pathsModule from "./utils/paths.ts";

const { isLocalPath, resolvePath } = pathsModule;
const { awaited, awaiting } = awaitingModule;
const { showStartupSelector } = startupUi;
const { formatMissingSessionCwdPrompt } = sessionCwdModule;

function resolveCliPaths(cwd: string, paths: string[] | undefined): string[] | undefined {
  return paths?.map((value) => (isLocalPath(value) ? resolvePath(value, cwd) : value));
}

function promptForMissingSessionCwd(
  issue: sessionCwdTypes.SessionCwdIssue,
  settingsManager: settingsManagerTypes.SettingsManager,
): Promise<string | undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      return yield* awaited(
        showStartupSelector(settingsManager, formatMissingSessionCwdPrompt(issue), [
          { label: "Continue", value: issue.fallbackCwd },
          { label: "Cancel", value: undefined },
        ]),
      );
    }),
  );
}

const mainPart11 = {
  promptForMissingSessionCwd,
  resolveCliPaths,
};

export default mainPart11;
