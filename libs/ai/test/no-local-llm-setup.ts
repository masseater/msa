import testing from "@msa/testing";
import { vi } from "vite-plus/test";

const BLOCKED =
  "node-llama-cpp is blocked without MSA_LOCAL_LLM_TESTS=1: gate the test with it.skipIf(!localLlmTests) from @msa/testing";

const blocked = () => {
  throw new Error(BLOCKED);
};

vi.mock("node-llama-cpp", (importOriginal) =>
  testing.localLlmTests
    ? importOriginal()
    : {
        LlamaLogLevel: { error: "error" },
        getLlama: blocked,
        resolveChatWrapper: blocked,
        resolveModelFile: blocked,
      },
);
