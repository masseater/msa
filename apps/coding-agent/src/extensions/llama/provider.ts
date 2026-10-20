import providerPart1 from "./provider-part1.ts";
import providerPart2 from "./provider-part2.ts";

const { DEFAULT_LLAMA_SERVER_URL, LLAMA_PROVIDER_ID } = providerPart1;
const { createLlamaProvider } = providerPart2;

const provider = {
  DEFAULT_LLAMA_SERVER_URL,
  LLAMA_PROVIDER_ID,
  createLlamaProvider,
};

export default provider;
