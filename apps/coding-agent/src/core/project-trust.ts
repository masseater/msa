import * as Effect from "effect/Effect";

import config from "../config.ts";
import awaitingModule from "./awaiting.ts";
import runnerEvents from "./extensions/runner-events.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import type projectTrustTypes from "./project-trust.types.ts";
import settingsDefaults from "./settings-defaults.ts";
import trustManager from "./trust-manager.ts";
import type trustManagerTypes from "./trust-manager.types.ts";

const { APP_NAME, CONFIG_DIR_NAME } = config;
const { getProjectTrustOptions, hasTrustRequiringProjectResources } = trustManager;
const { awaited, awaiting, performed } = awaitingModule;
const { emitProjectTrustEvent } = runnerEvents;
const { SETTINGS_DEFAULTS } = settingsDefaults;

function formatProjectTrustPrompt(cwd: string): string {
  return `Trust project folder?\n${cwd}\n\nThis allows ${APP_NAME} to load ${CONFIG_DIR_NAME} settings and resources, install missing project packages, and execute project extensions.`;
}

function selectProjectTrustOption(
  cwd: string,
  ctx: extensionsTypesTypes.ProjectTrustContext,
): Effect.Effect<trustManagerTypes.ProjectTrustOption | undefined> {
  return awaiting(function* () {
    const options = getProjectTrustOptions(cwd, { includeSessionOnly: true });
    const selected = yield* awaited(
      ctx.ui.select(
        formatProjectTrustPrompt(cwd),
        options.map((option) => option.label),
      ),
    );
    return options.find((option) => option.label === selected);
  });
}

function saveProjectTrustPromptResult(
  trustStore: trustManagerTypes.ProjectTrustStore,
  result: trustManagerTypes.ProjectTrustOption,
): void {
  if (result.updates.length > 0) {
    trustStore.setMany(result.updates);
  }
}

function resolveProjectTrusted(
  options: projectTrustTypes.ResolveProjectTrustedOptions,
): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      if (options.trustOverride !== undefined) {
        return options.trustOverride;
      }
      if (!hasTrustRequiringProjectResources(options.cwd)) {
        return true;
      }

      if (options.extensionsResult !== undefined) {
        const { result, errors } = yield* awaited(
          emitProjectTrustEvent(
            options.extensionsResult,
            { cwd: options.cwd, type: "project_trust" },
            options.projectTrustContext,
          ),
        );
        for (const error of errors) {
          options.onExtensionError?.(
            `Extension "${error.extensionPath}" project_trust error: ${error.error}`,
          );
        }
        if (result !== undefined) {
          const trusted = result.trusted === "yes";
          if (result.remember === true) {
            options.trustStore.set(options.cwd, trusted);
          }
          return trusted;
        }
      }

      const decision = options.trustStore.get(options.cwd);
      if (decision !== null) {
        return decision;
      }

      switch (options.defaultProjectTrust ?? SETTINGS_DEFAULTS.defaultProjectTrust) {
        case "always":
          return true;
        case "never":
          return false;
        case "ask":
          break;
      }

      if (!options.projectTrustContext.hasUI) {
        return false;
      }

      const selected = yield* performed(
        selectProjectTrustOption(options.cwd, options.projectTrustContext),
      );
      if (selected !== undefined) {
        saveProjectTrustPromptResult(options.trustStore, selected);
        return selected.trusted;
      }
      return false;
    }),
  );
}

const projectTrust = {
  resolveProjectTrusted,
};

export default projectTrust;
