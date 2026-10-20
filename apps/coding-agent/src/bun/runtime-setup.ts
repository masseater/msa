import bunOauth from "@msa/ai/bun-oauth";
import quickjsWasmPath from "quickjs-wasi/quickjs.wasm";

import config from "../config.ts";

const { APP_NAME, setEmbeddedQuickJSWasmPath } = config;

const { registerBunOAuthFlows } = bunOauth;

function setupBunRuntime(): void {
  process.title = APP_NAME;
  process.emitWarning = (() => {}) as typeof process.emitWarning;
  registerBunOAuthFlows();
  setEmbeddedQuickJSWasmPath(quickjsWasmPath);
}

const runtimeSetup = {
  setupBunRuntime,
};

export default runtimeSetup;
