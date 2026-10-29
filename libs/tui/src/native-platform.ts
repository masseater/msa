import env from "./env.ts";
import nativeAddon from "./native-addon.ts";
import nativeModulePath from "./native-module-path.ts";
import type nativePlatformTypes from "./native-platform.types.ts";
import platformModule from "./platform.ts";

const { pathOperations } = platformModule;
const { getNativeModuleCandidates } = nativeModulePath;
const { isEnvSet } = env;
const { loadNativeAddon } = nativeAddon;

type NativePlatformHelper = nativePlatformTypes.NativeClipboard & {
  enableVirtualTerminalInput?: () => boolean;
  isModifierPressed?: (name: nativePlatformTypes.ModifierKey) => boolean;
};

const helpers = new Map<string, NativePlatformHelper | undefined>();
const embeddedModules = new Map<string, string>();

function setEmbeddedNativeModules(modules: Readonly<Record<string, string>>): void {
  for (const [nativePath, modulePath] of Object.entries(modules)) {
    embeddedModules.set(nativePath, modulePath);
  }
  helpers.clear();
}

function loadNativePlatformHelper(platform: string, suffix = ""): NativePlatformHelper | undefined {
  const arch = process.arch;
  if (arch !== "x64" && arch !== "arm64") return undefined;
  const nativePath = [
    "native",
    platform,
    "prebuilds",
    `${platform}-${arch}`,
    `${platform}-platform${suffix}.node`,
  ].join("/");
  if (helpers.has(nativePath)) return helpers.get(nativePath);

  const embedded = embeddedModules.get(nativePath);
  const candidates =
    embedded === undefined
      ? getNativeModuleCandidates(pathOperations.join(...nativePath.split("/")))
      : [embedded];
  for (const modulePath of candidates) {
    try {
      const helper = loadNativeAddon(modulePath) as Partial<NativePlatformHelper> | null;
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
  setEmbeddedNativeModules,
};

export default nativePlatform;
