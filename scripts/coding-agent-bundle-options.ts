import type { BuildOptions, Plugin } from "esbuild";

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

const goRegExp = (pattern: RegExp): RegExp =>
  new RegExp(pattern.source, pattern.flags.replace("u", ""));

const lazyJitiPlugin: Plugin = {
  name: "lazy-jiti-transform",
  setup(esbuild) {
    esbuild.onResolve({ filter: goRegExp(/^jiti\/static$/u) }, () => ({
      namespace: "lazy-jiti",
      path: "jiti/static",
    }));
    esbuild.onLoad({ filter: goRegExp(/.*/u), namespace: "lazy-jiti" }, () => ({
      contents: LAZY_JITI_SOURCE,
      loader: "js",
    }));
  },
};

const commonBuildOptions = (repoRoot: string): BuildOptions => ({
  absWorkingDir: repoRoot,
  banner: BANNER,
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

export { ALLOWED_EXTERNAL_PACKAGES, commonBuildOptions };
