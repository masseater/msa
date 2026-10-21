import chalk from "chalk";
import * as Effect from "effect/Effect";

import awaitingModule from "../core/awaiting.ts";
import type extensionsTypesTypes from "../core/extensions/types.types.ts";
import platform from "../core/platform.ts";
import type projectTrustTypesModule from "../core/project-trust.types.ts";
import type settingsManagerTypes from "../core/settings-manager.types.ts";
import startupUi from "./startup-ui.ts";

const { awaited, awaiting } = awaitingModule;
const { showStartupInput, showStartupSelector } = startupUi;
const { writeError } = platform;

interface ProjectTrustOptions {
  cwd: string;
  mode: projectTrustTypesModule.AppMode;
  settingsManager: settingsManagerTypes.SettingsManager;
  hasUI: boolean;
}

function notifyOutsideInteractive(options: ProjectTrustOptions, type: string, message: string) {
  if (options.mode !== "interactive") {
    const color = type === "error" ? chalk.red : type === "warning" ? chalk.yellow : chalk.cyan;
    writeError(color(message));
  }
}

function createProjectTrustContext(
  options: ProjectTrustOptions,
): extensionsTypesTypes.ProjectTrustContext {
  const canPrompt = options.hasUI && options.mode === "interactive";
  const prompt = <T>(show: () => Promise<T | undefined>): Promise<T | undefined> =>
    Effect.runPromise(
      awaiting(function* () {
        if (!canPrompt) return undefined;
        return yield* awaited(show());
      }),
    );
  return {
    cwd: options.cwd,
    hasUI: options.hasUI,
    mode: options.mode === "interactive" ? "tui" : options.mode,
    ui: {
      confirm: (title, message) =>
        Effect.runPromise(
          awaiting(function* () {
            const choice = yield* awaited(
              prompt(() =>
                showStartupSelector(options.settingsManager, `${title}\n${message}`, [
                  { label: "Yes", value: true },
                  { label: "No", value: false },
                ]),
              ),
            );
            return choice ?? false;
          }),
        ),
      input: (title, placeholder) =>
        prompt(() => showStartupInput(options.settingsManager, title, placeholder)),
      notify: (message, type = "info") => notifyOutsideInteractive(options, type, message),
      select: (title, selectOptions) =>
        prompt(() =>
          showStartupSelector(
            options.settingsManager,
            title,
            selectOptions.map((option) => ({ label: option, value: option })),
          ),
        ),
    },
  };
}

const projectTrust = {
  createProjectTrustContext,
};

export default projectTrust;
