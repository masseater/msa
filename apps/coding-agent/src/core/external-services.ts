import * as Effect from "effect/Effect";

import { awaited, awaiting } from "./awaiting.ts";
import { claudeCodeService } from "./cli-agents/claude-service.ts";
import type { ToolDefinition } from "./extensions/types.ts";
import { createWebFetchToolDefinition } from "./tools/web-fetch.ts";
import { createWebSearchToolDefinition } from "./tools/web-search.ts";
import { TREG_INSTALL_COMMAND, findTreg, findTregCli, loginTreg, logoutTreg } from "./treg.ts";

export interface ServiceSignInPage {
  url: string;
  code?: string;
}

export type ServiceStatus =
  | { installed: false; install: string }
  | { installed: true; signedIn: boolean };

export interface ServiceLogoutInteraction {
  select(title: string, options: string[]): Promise<string>;
}

export interface ServiceLoginInteraction extends ServiceLogoutInteraction {
  showPage(page: ServiceSignInPage): void;
  prompt(message: string, placeholder?: string): Promise<string>;
}

export interface ExternalService {
  id: string;
  name: string;
  purpose: string;
  status(): Promise<ServiceStatus>;
  login(interaction: ServiceLoginInteraction, signal: AbortSignal): Promise<void>;
  logout(interaction: ServiceLogoutInteraction): Promise<void>;
  tools?(): ToolDefinition[];
}

const treg: ExternalService = {
  id: "treg",
  login(interaction, signal) {
    return Effect.runPromise(
      awaiting(function* () {
        const cli = findTregCli();
        if (cli === undefined)
          throw new Error(`treg is not installed. Install it with: ${TREG_INSTALL_COMMAND}`);
        yield* awaited(loginTreg(cli.command, (page) => interaction.showPage(page), signal));
      }),
    );
  },
  logout() {
    return Effect.runPromise(
      awaiting(function* () {
        const cli = findTregCli();
        if (cli !== undefined) yield* awaited(logoutTreg(cli.command));
      }),
    );
  },
  name: "treg",
  purpose: "web search and page reading",
  status() {
    return Effect.runPromise(
      Effect.sync(() => {
        const cli = findTregCli();
        return cli === undefined
          ? { installed: false, install: TREG_INSTALL_COMMAND }
          : { installed: true, signedIn: cli.signedIn };
      }),
    );
  },
  tools() {
    const options = findTreg();
    return options === undefined
      ? []
      : [
          createWebSearchToolDefinition(options) as ToolDefinition,
          createWebFetchToolDefinition(options) as ToolDefinition,
        ];
  },
};

export const EXTERNAL_SERVICES: readonly ExternalService[] = [treg, claudeCodeService];

export function findExternalService(
  services: readonly ExternalService[],
  ref: string,
): ExternalService | undefined {
  const normalized = ref.trim().toLowerCase();
  return services.find(
    (service) => service.id === normalized || service.name.toLowerCase() === normalized,
  );
}
