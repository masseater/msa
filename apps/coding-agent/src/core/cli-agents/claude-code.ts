import type compatTypes from "@msa/ai/compat.types";

import claudeAccounts from "./claude-accounts.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";
import claudeCodeAttach from "./claude-code-attach.ts";
import claudeCodeStream from "./claude-code-stream.ts";
import providerModule from "./provider.ts";
import type providerTypes from "./provider.types.ts";

const { cachedAccounts, claudeExecutable } = claudeAccounts;
const { PROVIDER_ID } = claudeCodeAttach;
const { streamFor } = claudeCodeStream;
const { cliAgentProvider } = providerModule;

const MODELS = [
  { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
] as const;

const cliModel = (model: (typeof MODELS)[number]): providerTypes.CliAgentModel => ({
  contextWindow: 1_000_000,
  id: model.id,
  input: ["text", "image"],
  maxTokens: 128_000,
  name: model.name,
  reasoning: true,
});

function provider(
  id: string,
  name: string,
  account?: claudeAccountsTypes.Account,
): compatTypes.Provider {
  return cliAgentProvider({
    executable: claudeExecutable,
    id,
    models: MODELS.map(cliModel),
    name,
    streamSimple: streamFor(account),
  });
}

function claudeCodeProviders(): compatTypes.Provider[] {
  const accounts = cachedAccounts();
  const perAccount =
    accounts.length > 1
      ? accounts.map((account) =>
          provider(
            `${PROVIDER_ID}-${account.name}`,
            `Claude subscription (${account.name})`,
            account,
          ),
        )
      : [];
  return [provider(PROVIDER_ID, "Claude subscription"), ...perAccount];
}

const claudeCode = {
  claudeCodeProviders,
};

export default claudeCode;
