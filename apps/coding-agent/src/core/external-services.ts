/**
 * External services msa signs in to from `/login`, such as treg for web search. A service owns its
 * own sign-in (usually its CLI's login command) and contributes tools once it is signed in.
 */

import { claudeCodeService } from "./cli-agents/claude-service.ts";
import type { ToolDefinition } from "./extensions/types.ts";
import { createWebFetchToolDefinition } from "./tools/web-fetch.ts";
import { createWebSearchToolDefinition } from "./tools/web-search.ts";
import { findTreg, findTregCli, loginTreg, logoutTreg, TREG_INSTALL_COMMAND } from "./treg.ts";

/** The page the user approves the sign-in on. */
export interface ServiceSignInPage {
  url: string;
  /** A code the page shows, for the user to check it matches. */
  code?: string;
}

export type ServiceStatus =
  /** `install` is a shell command that installs what the service needs. */
  { installed: false; install: string } | { installed: true; signedIn: boolean };

/** What a service's sign-out can ask the user. */
export interface ServiceLogoutInteraction {
  /** Ask the user to pick one of `options`; rejects when they cancel. */
  select(title: string, options: string[]): Promise<string>;
}

/** What a service's sign-in can show and ask the user while it runs. */
export interface ServiceLoginInteraction extends ServiceLogoutInteraction {
  /** Show the page the user approves the sign-in on. */
  showPage(page: ServiceSignInPage): void;
  /** Ask the user for text, such as a code the sign-in page shows; rejects when they cancel. */
  prompt(message: string, placeholder?: string): Promise<string>;
}

/**
 * A SaaS msa depends on, signed in to from `/login`. msa registers its own in
 * {@link EXTERNAL_SERVICES}; extensions add theirs with `msa.registerExternalService()`.
 */
export interface ExternalService {
  id: string;
  name: string;
  /** What msa uses the service for, shown next to it in `/login`. */
  purpose: string;
  status(): Promise<ServiceStatus>;
  login(interaction: ServiceLoginInteraction, signal: AbortSignal): Promise<void>;
  logout(interaction: ServiceLogoutInteraction): Promise<void>;
  /** The tools the service provides, empty until it is signed in. */
  tools?(): ToolDefinition[];
}

const treg: ExternalService = {
  id: "treg",
  name: "treg",
  purpose: "web search and page reading",
  async status() {
    const cli = findTregCli();
    return cli
      ? { installed: true, signedIn: cli.signedIn }
      : { installed: false, install: TREG_INSTALL_COMMAND };
  },
  async login(interaction, signal) {
    const cli = findTregCli();
    if (!cli) throw new Error(`treg is not installed. Install it with: ${TREG_INSTALL_COMMAND}`);
    await loginTreg(cli.command, (page) => interaction.showPage(page), signal);
  },
  async logout() {
    const cli = findTregCli();
    if (cli) await logoutTreg(cli.command);
  },
  tools() {
    const options = findTreg();
    return options
      ? [
          createWebSearchToolDefinition(options) as ToolDefinition,
          createWebFetchToolDefinition(options) as ToolDefinition,
        ]
      : [];
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
