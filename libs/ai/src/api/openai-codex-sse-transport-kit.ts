import headers from "../utils/headers.ts";
import hooks from "../utils/hooks.ts";
import openaiCodexCompress from "./openai-codex-compress.ts";

const openaiCodexSseTransportKit = {
  headers,
  hooks,
  openaiCodexCompress,
};

export default openaiCodexSseTransportKit;
