import { dual } from "effect/Function";

import platform from "../../../core/platform/index.ts";

const { isAbsolute, relative, resolve, sep } = platform;

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}
const formatCwdForFooter: {
  (home: string | undefined): (cwd: string) => string;
  (cwd: string, home: string | undefined): string;
} = dual(2, (cwd: string, home: string | undefined): string => {
  if (home === undefined || home === "") return cwd;

  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === "" ||
    (relativeToHome !== ".." &&
      !relativeToHome.startsWith(`..${sep}`) &&
      !isAbsolute(relativeToHome));

  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
});

const footerSupport = {
  formatCwdForFooter,
  formatTokens,
};

export default footerSupport;
