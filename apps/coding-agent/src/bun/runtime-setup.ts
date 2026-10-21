import quickjsWasmPath from "quickjs-wasi/quickjs.wasm";

import config from "../config.ts";

const { APP_NAME, setEmbeddedQuickJSWasmPath } = config;

function setupBunRuntime(): void {
  process.title = APP_NAME;
  process.emitWarning = (() => {}) as typeof process.emitWarning;
  setEmbeddedQuickJSWasmPath(quickjsWasmPath);
}

const runtimeSetup = {
  setupBunRuntime,
};

export default runtimeSetup;
