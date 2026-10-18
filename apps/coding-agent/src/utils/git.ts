import hostedGitInfo from "hosted-git-info";

export type GitSource = {
  type: "git";

  repo: string;

  host: string;

  path: string;

  ref?: string | undefined;

  pinned: boolean;
};

function splitRef(url: string): { repo: string; ref?: string } {
  const scpLikeMatch = url.match(/^git@([^:]+):(.+)$/u);
  if (scpLikeMatch !== null) {
    const pathWithMaybeRef = scpLikeMatch[2] ?? "";
    const refSeparator = pathWithMaybeRef.indexOf("@");
    if (refSeparator < 0) return { repo: url };
    const repoPath = pathWithMaybeRef.slice(0, refSeparator);
    const ref = pathWithMaybeRef.slice(refSeparator + 1);
    if (repoPath === "" || ref === "") return { repo: url };
    return {
      repo: `git@${scpLikeMatch[1] ?? ""}:${repoPath}`,
      ref,
    };
  }

  if (url.includes("://")) {
    try {
      const parsed = new URL(url);
      const pathWithMaybeRef = parsed.pathname.replace(/^\/+/u, "");
      const refSeparator = pathWithMaybeRef.indexOf("@");
      if (refSeparator < 0) return { repo: url };
      const repoPath = pathWithMaybeRef.slice(0, refSeparator);
      const ref = pathWithMaybeRef.slice(refSeparator + 1);
      if (repoPath === "" || ref === "") return { repo: url };
      parsed.pathname = `/${repoPath}`;
      return {
        repo: parsed.toString().replace(/\/$/u, ""),
        ref,
      };
    } catch {
      return { repo: url };
    }
  }

  const slashIndex = url.indexOf("/");
  if (slashIndex < 0) {
    return { repo: url };
  }
  const host = url.slice(0, slashIndex);
  const pathWithMaybeRef = url.slice(slashIndex + 1);
  const refSeparator = pathWithMaybeRef.indexOf("@");
  if (refSeparator < 0) {
    return { repo: url };
  }
  const repoPath = pathWithMaybeRef.slice(0, refSeparator);
  const ref = pathWithMaybeRef.slice(refSeparator + 1);
  if (repoPath === "" || ref === "") {
    return { repo: url };
  }
  return {
    repo: `${host}/${repoPath}`,
    ref,
  };
}

function decodeForValidation(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function hasUnsafeGitInstallPart(value: string, allowSlash: boolean): boolean {
  const decoded = decodeForValidation(value);
  if (decoded === null) {
    return true;
  }
  const candidates = [value, decoded];
  for (const candidate of candidates) {
    if (candidate.includes("\0") || candidate.includes("\\") || candidate.startsWith("/")) {
      return true;
    }
    if (!allowSlash && candidate.includes("/")) {
      return true;
    }
    if (candidate.split("/").includes("..")) {
      return true;
    }
  }
  return false;
}

function buildGitSource(args: {
  repo: string;
  host: string;
  path: string;
  ref?: string | undefined;
}): GitSource | null {
  if (args.path.startsWith("/")) {
    return null;
  }
  const normalizedPath = args.path.replace(/\.git$/u, "").replace(/^\/+/u, "");
  if (args.host === "" || normalizedPath === "" || normalizedPath.split("/").length < 2) {
    return null;
  }
  if (hasUnsafeGitInstallPart(args.host, false) || hasUnsafeGitInstallPart(normalizedPath, true)) {
    return null;
  }

  return {
    type: "git",
    repo: args.repo,
    host: args.host,
    path: normalizedPath,
    ref: args.ref,
    pinned: Boolean(args.ref),
  };
}

function parseGenericGitUrl(url: string): GitSource | null {
  const { repo: repoWithoutRef, ref } = splitRef(url);
  let repo = repoWithoutRef;
  let host: string;
  let path: string;

  const scpLikeMatch = repoWithoutRef.match(/^git@([^:]+):(.+)$/u);
  if (scpLikeMatch !== null) {
    host = scpLikeMatch[1] ?? "";
    path = scpLikeMatch[2] ?? "";
  } else if (
    repoWithoutRef.startsWith("https://") ||
    repoWithoutRef.startsWith("http://") ||
    repoWithoutRef.startsWith("ssh://") ||
    repoWithoutRef.startsWith("git://")
  ) {
    try {
      const parsed = new URL(repoWithoutRef);
      host = parsed.hostname;
      path = parsed.pathname.replace(/^\/+/u, "");
    } catch {
      return null;
    }
  } else {
    const slashIndex = repoWithoutRef.indexOf("/");
    if (slashIndex < 0) {
      return null;
    }
    host = repoWithoutRef.slice(0, slashIndex);
    path = repoWithoutRef.slice(slashIndex + 1);
    if (!host.includes(".") && host !== "localhost") {
      return null;
    }
    repo = `https://${repoWithoutRef}`;
  }

  return buildGitSource({ repo, host, path, ref });
}

export function parseGitUrl(source: string): GitSource | null {
  const trimmed = source.trim();
  const hasGitPrefix = trimmed.startsWith("git:");
  const url = hasGitPrefix ? trimmed.slice(4).trim() : trimmed;

  if (!hasGitPrefix && !/^(https?|ssh|git):\/\//iu.test(url)) {
    return null;
  }

  const split = splitRef(url);

  const hostedCandidates = [
    split.ref !== undefined && split.ref !== "" ? `${split.repo}#${split.ref}` : undefined,
    url,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of hostedCandidates) {
    const info = hostedGitInfo.fromUrl(candidate);
    if (info !== undefined) {
      if (split.ref !== undefined && split.ref !== "" && info.project?.includes("@")) {
        continue;
      }
      const useHttpsPrefix =
        !split.repo.startsWith("http://") &&
        !split.repo.startsWith("https://") &&
        !split.repo.startsWith("ssh://") &&
        !split.repo.startsWith("git://") &&
        !split.repo.startsWith("git@");
      return buildGitSource({
        repo: useHttpsPrefix ? `https://${split.repo}` : split.repo,
        host: info.domain || "",
        path: `${info.user}/${info.project}`,
        ref: info.committish || split.ref || undefined,
      });
    }
  }

  const httpsCandidates = [
    split.ref !== undefined && split.ref !== "" ? `https://${split.repo}#${split.ref}` : undefined,
    `https://${url}`,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of httpsCandidates) {
    const info = hostedGitInfo.fromUrl(candidate);
    if (info !== undefined) {
      if (split.ref !== undefined && split.ref !== "" && info.project?.includes("@")) {
        continue;
      }
      return buildGitSource({
        repo: `https://${split.repo}`,
        host: info.domain || "",
        path: `${info.user}/${info.project}`,
        ref: info.committish || split.ref || undefined,
      });
    }
  }

  return parseGenericGitUrl(url);
}
