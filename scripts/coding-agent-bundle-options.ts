import type { BuildOptions, Plugin } from "esbuild";

import esbuildFilter from "./esbuild-filter.ts";

const { EsbuildFilter } = esbuildFilter;

const ALLOWED_EXTERNAL_PACKAGES = new Set([
  "@silvia-odwyer/photon-node",
  "jiti",
  "bufferutil",
  "utf-8-validate",
  "kerberos",
  "supports-color",
]);

const BANNER = {
  js: 'import { createRequire as __piCreateRequire } from "node:module"; const require = __piCreateRequire(import.meta.url);',
};

const LAZY_JITI_SOURCE = `
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let createJitiImpl;

export function createJiti(...args) {
	createJitiImpl ??= require("jiti").createJiti;
	return createJitiImpl(...args);
}
`;

const lazyJitiPlugin: Plugin = {
  name: "lazy-jiti-transform",
  setup(esbuild) {
    esbuild.onResolve({ filter: new EsbuildFilter(/^jiti\/static$/u) }, () => ({
      namespace: "lazy-jiti",
      path: "jiti/static",
    }));
    esbuild.onLoad({ filter: new EsbuildFilter(/.*/u), namespace: "lazy-jiti" }, () => ({
      contents: LAZY_JITI_SOURCE,
      loader: "js",
    }));
  },
};

const unbannedBuildOptions = (repoRoot: string): BuildOptions => ({
  absWorkingDir: repoRoot,
  bundle: true,
  define: { MSA_BUNDLED_NODE: "true" },
  external: ["@silvia-odwyer/photon-node"],
  format: "esm",
  legalComments: "none",
  logLevel: "warning",
  metafile: true,
  minifySyntax: true,
  minifyWhitespace: true,
  platform: "node",
  plugins: [lazyJitiPlugin],
  sourcemap: false,
  target: "node22.19",
  tsconfigRaw: { compilerOptions: {} },
});

const commonBuildOptions = (repoRoot: string): BuildOptions => ({
  ...unbannedBuildOptions(repoRoot),
  banner: BANNER,
});

const codingAgentBundleOptions = {
  ALLOWED_EXTERNAL_PACKAGES,
  commonBuildOptions,
  unbannedBuildOptions,
};

export default codingAgentBundleOptions;
