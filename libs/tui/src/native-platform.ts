import { createRequire } from "node:module";

import env from "./env.ts";
import nativeModulePath from "./native-module-path.ts";
import type nativePlatformTypes from "./native-platform.types.ts";
import platformModule from "./platform.ts";

const { pathOperations } = platformModule;
const { getNativeModuleCandidates } = nativeModulePath;
const { isEnvSet } = env;

const cjsRequire = createRequire(import.meta.url);

type NativePlatformHelper = nativePlatformTypes.NativeClipboard & {
  enableVirtualTerminalInput?: () => boolean;
  isModifierPressed?: (name: nativePlatformTypes.ModifierKey) => boolean;
};

const helpers = new Map<string, NativePlatformHelper | undefined>();

function loadNativePlatformHelper(platform: string, suffix = ""): NativePlatformHelper | undefined {
  const arch = process.arch;
  if (arch !== "x64" && arch !== "arm64") return undefined;
  const nativePath = pathOperations.join(
    "native",
    platform,
    "prebuilds",
    `${platform}-${arch}`,
    `${platform}-platform${suffix}.node`,
  );
  if (helpers.has(nativePath)) return helpers.get(nativePath);

  for (const modulePath of getNativeModuleCandidates(nativePath)) {
    try {
      const helper = cjsRequire(modulePath) as Partial<NativePlatformHelper> | null;
      if (typeof helper?.getText === "function" && typeof helper.getImage === "function") {
        helpers.set(nativePath, helper as NativePlatformHelper);
        return helper as NativePlatformHelper;
      }
    } catch {}
  }
  helpers.set(nativePath, undefined);
  return undefined;
}

function getNativePlatformHelper(): NativePlatformHelper | undefined {
  if (process.platform !== "darwin" && process.platform !== "win32") return undefined;
  return loadNativePlatformHelper(process.platform);
}

function getNativeClipboard(): nativePlatformTypes.NativeClipboard | undefined {
  if (process.platform !== "linux") return getNativePlatformHelper();
  if (!isEnvSet("DISPLAY")) return undefined;
  return loadNativePlatformHelper("linux", "-x11");
}

const nativePlatform = {
  getNativeClipboard,
  getNativePlatformHelper,
};

export default nativePlatform;
