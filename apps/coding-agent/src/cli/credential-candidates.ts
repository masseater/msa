import type aiTypes from "@msa/ai/index.types";

import cliModelFlag from "../core/cli-model.ts";
import modelResolver from "../core/model-resolver.ts";
import type modelRuntimeTypes from "../core/model-runtime.types.ts";
import AuthCommandError from "./auth-command-error.ts";

const { resolveCliModel } = cliModelFlag;
const { resolveModelReference } = modelResolver;

interface CredentialCandidate {
  id: string;
  model?: aiTypes.Model<aiTypes.Api>;
}

interface CandidateQuery {
  cliProvider: string | undefined;
  cliModel: string | undefined;
  credentialTypes: ReadonlyMap<string, aiTypes.CredentialInfo["type"]>;
  modelRuntime: modelRuntimeTypes.ModelRuntime;
}

function namedProvider(
  { cliModel, modelRuntime }: CandidateQuery,
  cliProvider: string,
): CredentialCandidate {
  const provider = modelRuntime.getProvider(cliProvider);
  if (provider === undefined) {
    throw AuthCommandError.create(
      `Unknown provider "${cliProvider}". Use --list-models to see available providers.`,
    );
  }
  if (cliModel === undefined || cliModel === "") return { id: provider.id };
  const resolved = resolveCliModel({ cliModel, cliProvider: provider.id, modelRuntime });
  if ((resolved.error !== undefined && resolved.error !== "") || resolved.model === undefined) {
    throw AuthCommandError.create(
      resolved.error ?? "Unable to resolve the requested provider/model",
    );
  }
  return { id: provider.id, model: resolved.model };
}

function providersServingModel({
  cliModel,
  credentialTypes,
  modelRuntime,
}: CandidateQuery): CredentialCandidate[] {
  const models = modelRuntime.getModels();
  const candidates = modelRuntime.getProviders().flatMap((provider) => {
    if (!credentialTypes.has(provider.id)) return [];
    const resolved = resolveModelReference(
      { fuzzy: true, provider: provider.id, text: cliModel!, thinkingSuffix: "strict" },
      models,
      () => true,
    );
    return resolved.status === "resolved" ? [{ id: provider.id, model: resolved.model }] : [];
  });
  if (candidates.length === 0) {
    throw AuthCommandError.create(
      `Model "${cliModel}" not found. Use --list-models to see available models.`,
    );
  }
  return candidates;
}

const credentialCandidates = (query: CandidateQuery): CredentialCandidate[] =>
  query.cliProvider !== undefined && query.cliProvider !== ""
    ? [namedProvider(query, query.cliProvider)]
    : providersServingModel(query);

const credentialCandidatesModule = { credentialCandidates };

export default credentialCandidatesModule;
