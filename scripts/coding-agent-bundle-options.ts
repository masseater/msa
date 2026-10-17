import { createRequire } from "node:module";

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

const httpsProxyAgentDirectory = (repoRoot: string): string => {
  const resolved = createRequire(`${repoRoot}/libs/ai/package.json`).resolve("https-proxy-agent");
  return resolved.slice(0, resolved.lastIndexOf("/"));
};

const httpsProxyAgentNamedExportPlugin = (repoRoot: string): Plugin => ({
  name: "https-proxy-agent-named-export",
  setup(esbuild) {
    esbuild.onResolve({ filter: goRegExp(/^https-proxy-agent$/u) }, (args) =>
      args.kind === "dynamic-import"
        ? { namespace: "https-proxy-agent-named-export", path: args.path }
        : undefined,
    );
    esbuild.onLoad(
      {
        filter: goRegExp(/^https-proxy-agent$/u),
        namespace: "https-proxy-agent-named-export",
      },
      () => ({
        contents: 'export { HttpsProxyAgent } from "https-proxy-agent";',
        loader: "js",
        resolveDir: httpsProxyAgentDirectory(repoRoot),
      }),
    );
  },
});

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
  plugins: [lazyJitiPlugin, httpsProxyAgentNamedExportPlugin(repoRoot)],
  sourcemap: false,
  target: "node22.19",
  tsconfigRaw: { compilerOptions: {} },
});

export { ALLOWED_EXTERNAL_PACKAGES, commonBuildOptions };
