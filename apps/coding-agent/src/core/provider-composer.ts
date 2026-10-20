import providerComposerPart1 from "./provider-composer-part1.ts";
import providerComposerPart2 from "./provider-composer-part2.ts";
import providerComposerPart3 from "./provider-composer-part3.ts";
import providerComposerPart4 from "./provider-composer-part4.ts";

const { clearApiKeyCache } = providerComposerPart1;
const { composeModelProvider } = providerComposerPart3;
const {
  configuredRequestAuthStatus,
  resolveCompatibilityRequestConfig,
  resolveConfiguredModelHeaders,
} = providerComposerPart4;
const { validateExtensionProvider } = providerComposerPart2;

const providerComposer = {
  clearApiKeyCache,
  composeModelProvider,
  configuredRequestAuthStatus,
  resolveCompatibilityRequestConfig,
  resolveConfiguredModelHeaders,
  validateExtensionProvider,
};

export default providerComposer;
