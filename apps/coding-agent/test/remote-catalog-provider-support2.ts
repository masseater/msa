import { withRemoteCatalog } from "../src/core/remote-catalog-provider.ts";
import remoteCatalogProviderSupport from "./remote-catalog-provider-support.ts";

const { builtinProvider } = remoteCatalogProviderSupport;

function testProvider(localGeneratedAt?: number) {
  return withRemoteCatalog(builtinProvider(), "https://pi.dev", localGeneratedAt);
}

const remoteCatalogProviderSupport2 = {
  testProvider,
};

export default remoteCatalogProviderSupport2;
