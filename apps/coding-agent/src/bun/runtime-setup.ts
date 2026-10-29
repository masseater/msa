import quickjsWasmPath from "quickjs-wasi/quickjs.wasm";

import config from "../config.ts";

import exportTemplateCssPath from "../core/export-html/template.css" with { type: "file" };

const { APP_NAME, setEmbeddedExportTemplateCssPath, setEmbeddedQuickJSWasmPath } = config;

function setupBunRuntime(): void {
  process.title = APP_NAME;
  process.emitWarning = (() => {}) as typeof process.emitWarning;
  setEmbeddedQuickJSWasmPath(quickjsWasmPath);
  setEmbeddedExportTemplateCssPath(exportTemplateCssPath);
}

const runtimeSetup = {
  setupBunRuntime,
};

export default runtimeSetup;
