import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import platformNode from "../platform-node.ts";
import type resourceLoaderTypes from "../resource-loader.types.ts";
import sourceInfoModule from "../source-info.ts";

const { awaited, awaitingWith } = awaitingModule;
const { isSyntheticPath } = sourceInfoModule;
const { basename, dirname } = platformNode;

export default class SessionExtensionResources {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  private buildExtensionResourcePaths(
    entries: Array<{ path: string; extensionPath: string }>,
  ): Array<{
    path: string;
    metadata: { source: string; scope: "temporary"; origin: "top-level"; baseDir?: string };
  }> {
    return entries.map((entry) => {
      const source = this.getExtensionSourceLabel(entry.extensionPath);
      const baseDir = isSyntheticPath(entry.extensionPath)
        ? undefined
        : dirname(entry.extensionPath);
      return {
        metadata: {
          origin: "top-level",
          scope: "temporary",
          source,
          ...(baseDir === undefined ? {} : { baseDir }),
        },
        path: entry.path,
      };
    });
  }

  private getExtensionSourceLabel(extensionPath: string): string {
    if (isSyntheticPath(extensionPath)) {
      return `extension:${extensionPath.replace(/[<>]/gu, "")}`;
    }
    const base = basename(extensionPath);
    const name = base.replace(/\.(ts|js)$/u, "");
    return `extension:${name}`;
  }

  extendResourcesFromExtensions(reason: "startup" | "reload"): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (
        !this.session.extensions.binding.extensionRunnerInternal.hasHandlers("resources_discover")
      ) {
        return;
      }

      const { skillPaths, promptPaths, themePaths } = yield* awaited(
        this.session.extensions.binding.extensionRunnerInternal.emitResourcesDiscover(
          this.session.cwd,
          reason,
        ),
      );

      if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) {
        return;
      }

      const extensionPaths: resourceLoaderTypes.ResourceExtensionPaths = {
        promptPaths: this.buildExtensionResourcePaths(promptPaths),
        skillPaths: this.buildExtensionResourcePaths(skillPaths),
        themePaths: this.buildExtensionResourcePaths(themePaths),
      };

      this.session.resourceLoader.extendResources(extensionPaths);
      this.session.tools.prompt.rebuildSystemPrompt(
        this.session.tools.loadout.getActiveToolNames(),
      );
    }, this);
  }
}
