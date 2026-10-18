import { createRequire } from "node:module";

import type { BuildOptions, Plugin } from "esbuild";

import { EsbuildFilter } from "./esbuild-filter.ts";

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

const httpsProxyAgentDirectory = (repoRoot: string): string => {
  const resolved = createRequire(`${repoRoot}/libs/ai/package.json`).resolve("https-proxy-agent");
  return resolved.slice(0, resolved.lastIndexOf("/"));
};

const httpsProxyAgentNamedExportPlugin = (repoRoot: string): Plugin => ({
  name: "https-proxy-agent-named-export",
  setup(esbuild) {
    esbuild.onResolve({ filter: new EsbuildFilter(/^https-proxy-agent$/u) }, (args) =>
      args.kind === "dynamic-import"
        ? { namespace: "https-proxy-agent-named-export", path: args.path }
        : undefined,
    );
    esbuild.onLoad(
      {
        filter: new EsbuildFilter(/^https-proxy-agent$/u),
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
  plugins: [lazyJitiPlugin, httpsProxyAgentNamedExportPlugin(repoRoot)],
  sourcemap: false,
  target: "node22.19",
  tsconfigRaw: { compilerOptions: {} },
});

const commonBuildOptions = (repoRoot: string): BuildOptions => ({
  ...unbannedBuildOptions(repoRoot),
  banner: BANNER,
});

export { ALLOWED_EXTERNAL_PACKAGES, commonBuildOptions, unbannedBuildOptions };
