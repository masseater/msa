import bunOauth from "@msa/ai/bun-oauth";
import quickjsWasmPath from "quickjs-wasi/quickjs.wasm";

import { APP_NAME, setEmbeddedQuickJSWasmPath } from "../config.ts";

const { registerBunOAuthFlows } = bunOauth;

export function setupBunRuntime(): void {
  process.title = APP_NAME;
  process.emitWarning = (() => {}) as typeof process.emitWarning;
  registerBunOAuthFlows();
  setEmbeddedQuickJSWasmPath(quickjsWasmPath);
}
