import tui from "@msa/tui";
import photonWasmPath from "@silvia-odwyer/photon-node/photon_rs_bg.wasm" with { type: "file" };
import quickjsWasmPath from "quickjs-wasi/quickjs.wasm";

import changelogPath from "../../CHANGELOG.md" with { type: "file" };
import config from "../config.ts";
import photon from "../utils/photon.ts";
import embeddedNativeModules from "./embedded-native-modules.ts";

import exportTemplateCssPath from "../core/export-html/template.css" with { type: "file" };

const { APP_NAME, setEmbeddedAssets } = config;

function setupBunRuntime(): void {
  process.title = APP_NAME;
  process.emitWarning = (() => {}) as typeof process.emitWarning;
  setEmbeddedAssets({
    changelog: changelogPath,
    exportTemplateCss: exportTemplateCssPath,
    quickJSWasm: quickjsWasmPath,
  });
  photon.setEmbeddedWasmPath(photonWasmPath);
  tui.setEmbeddedNativeModules(embeddedNativeModules);
}

const runtimeSetup = {
  setupBunRuntime,
};

export default runtimeSetup;
