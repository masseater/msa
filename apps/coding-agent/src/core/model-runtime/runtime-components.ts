import ai from "@msa/ai";

import CredentialOperations from "./credential-operations.ts";
import ModelAuth from "./model-auth.ts";
import ModelAvailability from "./model-availability.ts";
import ModelRequests from "./model-requests.ts";
import ProviderCatalog from "./provider-catalog.ts";
import ProviderRegistrations from "./provider-registrations.ts";
import type runtimeParts from "./runtime-parts.ts";
import VirtualModelRegistry from "./virtual-model-registry.ts";

const { createModels } = ai;

type RuntimeParts = Awaited<ReturnType<typeof runtimeParts.loadRuntimeParts>>;
type RuntimeHost = Omit<ConstructorParameters<typeof ModelRequests>[0], "models"> & {
  refresh: () => void;
};

const createRuntimeComponents = (parts: RuntimeParts, host: RuntimeHost) => {
  const { credentials } = parts;
  const models = createModels({ credentials, modelsStore: parts.modelsStore });
  const virtualModels = new VirtualModelRegistry();
  const catalog = new ProviderCatalog(models, parts.catalogProviders, parts.config, virtualModels);
  const availability = new ModelAvailability(models, credentials);
  const auth = new ModelAuth(models, credentials, catalog, availability);
  return {
    auth,
    availability,
    catalog,
    credentialOperations: new CredentialOperations(models, credentials, catalog, availability),
    credentials,
    models,
    registrations: new ProviderRegistrations({
      auth,
      availability,
      catalog,
      models,
      refresh: host.refresh,
      virtualModels,
    }),
    requests: new ModelRequests({ ...host, models }),
    virtualModels,
  };
};

const runtimeComponents = { createRuntimeComponents };

export default runtimeComponents;
