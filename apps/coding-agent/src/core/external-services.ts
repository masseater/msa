import type { ToolDefinition } from "./extensions/types.ts";
import { createWebFetchToolDefinition } from "./tools/web-fetch.ts";
import { createWebSearchToolDefinition } from "./tools/web-search.ts";
import { findTreg, findTregCli, loginTreg, logoutTreg, TREG_INSTALL_COMMAND } from "./treg.ts";

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

export const EXTERNAL_SERVICES: readonly ExternalService[] = [treg];

export function findExternalService(
  services: readonly ExternalService[],
  ref: string,
): ExternalService | undefined {
  const normalized = ref.trim().toLowerCase();
  return services.find(
    (service) => service.id === normalized || service.name.toLowerCase() === normalized,
  );
}
