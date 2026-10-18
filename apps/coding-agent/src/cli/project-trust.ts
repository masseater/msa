import chalk from "chalk";
import * as Effect from "effect/Effect";

import { awaited, awaiting } from "../core/awaiting.ts";
import type { ProjectTrustContext } from "../core/extensions/types.ts";
import { writeError } from "../core/platform.ts";
import type { AppMode } from "../core/project-trust.ts";
import type { SettingsManager } from "../core/settings-manager.ts";
import { showStartupInput, showStartupSelector } from "./startup-ui.ts";

export function createProjectTrustContext(options: {
  cwd: string;
  mode: AppMode;
  settingsManager: SettingsManager;
  hasUI: boolean;
}): ProjectTrustContext {
  return {
    cwd: options.cwd,
    mode: options.mode === "interactive" ? "tui" : options.mode,
    hasUI: options.hasUI,
    ui: {
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
        if (options.mode !== "interactive") {
          const color =
            type === "error" ? chalk.red : type === "warning" ? chalk.yellow : chalk.cyan;
          writeError(color(message));
        }
      },
    },
  };
}
