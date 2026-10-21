import platform from "./platform.ts";

const { pathOperations } = platform;

const loadNativeAddon = (path: string): unknown => {
  const module: { exports: unknown } = { exports: {} };
  process.dlopen(module, pathOperations.toNamespacedPath(path));
  return module.exports;
};

const nativeAddon = { loadNativeAddon };

export default nativeAddon;
