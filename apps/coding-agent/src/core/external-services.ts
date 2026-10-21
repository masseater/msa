import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import claudeService from "./cli-agents/claude-service.ts";
import type extensionsTypesTypes from "./extensions/types.types.ts";
import type externalServicesTypes from "./external-services.types.ts";
import webFetch from "./tools/web-fetch.ts";
import webSearch from "./tools/web-search.ts";
import tregModule from "./treg.ts";

const { awaited, awaiting } = awaitingModule;
const { TREG_INSTALL_COMMAND, findTreg, findTregCli, loginTreg, logoutTreg } = tregModule;
const { createWebSearchToolDefinition } = webSearch;
const { createWebFetchToolDefinition } = webFetch;
const { claudeCodeService } = claudeService;

const treg: externalServicesTypes.ExternalService = {
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
          ? { install: TREG_INSTALL_COMMAND, installed: false }
          : { installed: true, signedIn: cli.signedIn };
      }),
    );
  },
  tools() {
    const options = findTreg();
    return options === undefined
      ? []
      : [
          createWebSearchToolDefinition(options) as extensionsTypesTypes.ToolDefinition,
          createWebFetchToolDefinition(options) as extensionsTypesTypes.ToolDefinition,
        ];
  },
};

const EXTERNAL_SERVICES: readonly externalServicesTypes.ExternalService[] = [
  treg,
  claudeCodeService,
];

function findExternalService(
  services: readonly externalServicesTypes.ExternalService[],
  ref: string,
): externalServicesTypes.ExternalService | undefined {
  const normalized = ref.trim().toLowerCase();
  return services.find(
    (service) => service.id === normalized || service.name.toLowerCase() === normalized,
  );
}

const externalServices = {
  EXTERNAL_SERVICES,
  findExternalService,
};

export default externalServices;
