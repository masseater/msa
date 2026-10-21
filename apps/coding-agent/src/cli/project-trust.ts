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

function createProjectTrustContext(options: {
  cwd: string;
  mode: projectTrustTypesModule.AppMode;
  settingsManager: settingsManagerTypes.SettingsManager;
  hasUI: boolean;
}): extensionsTypesTypes.ProjectTrustContext {
  return {
    cwd: options.cwd,
    hasUI: options.hasUI,
    mode: options.mode === "interactive" ? "tui" : options.mode,
    ui: {
      confirm: (title, message) =>
        Effect.runPromise(
          awaiting(function* () {
            if (!options.hasUI) {
              return false;
            }
            if (options.mode !== "interactive") {
              return false;
            }
            return (
              (yield* awaited(
                showStartupSelector(options.settingsManager, `${title}\n${message}`, [
                  { label: "Yes", value: true },
                  { label: "No", value: false },
                ]),
              )) ?? false
            );
          }),
        ),
      input: (title, placeholder) =>
        Effect.runPromise(
          awaiting(function* () {
            if (!options.hasUI) {
              return undefined;
            }
            if (options.mode !== "interactive") {
              return undefined;
            }
            return yield* awaited(showStartupInput(options.settingsManager, title, placeholder));
          }),
        ),
      notify: (message, type = "info") => {
        notifyOutsideInteractive(options, type, message);
      },
      select: (title, selectOptions) =>
        Effect.runPromise(
          awaiting(function* () {
            if (!options.hasUI) {
              return undefined;
            }
            if (options.mode !== "interactive") {
              return undefined;
            }
            return yield* awaited(
              showStartupSelector(
                options.settingsManager,
                title,
                selectOptions.map((option) => ({ label: option, value: option })),
              ),
            );
          }),
        ),
    },
  };
}

const projectTrust = {
  createProjectTrustContext,
};

export default projectTrust;

function notifyOutsideInteractive(
  options: {
    cwd: string;
    mode: projectTrustTypesModule.AppMode;
    settingsManager: settingsManagerTypes.SettingsManager;
    hasUI: boolean;
  },
  type: string,
  message: string,
) {
  if (options.mode !== "interactive") {
    const color = type === "error" ? chalk.red : type === "warning" ? chalk.yellow : chalk.cyan;
    writeError(color(message));
  }
}
