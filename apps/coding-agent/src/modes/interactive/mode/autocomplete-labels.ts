import type sourceInfoTypes from "../../../core/source-info.types.ts";
import git from "../../../utils/git.ts";
import type InteractiveMode from "../interactive-mode.ts";

const { parseGitUrl } = git;

export default class AutocompleteLabels {
  readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private getAutocompleteSourceTag(sourceInfo?: sourceInfoTypes.SourceInfo): string | undefined {
    if (sourceInfo === undefined || sourceInfo.source === "builtin") {
      return undefined;
    }

    const scopePrefix =
      sourceInfo.scope === "user" ? "u" : sourceInfo.scope === "project" ? "p" : "t";
    const source = sourceInfo.source.trim();

    if (source === "auto" || source === "local" || source === "cli") {
      return scopePrefix;
    }

    if (source.startsWith("npm:")) {
      return `${scopePrefix}:${source}`;
    }

    const gitSource = parseGitUrl(source);
    if (gitSource !== null) {
      const ref = gitSource.ref !== undefined && gitSource.ref !== "" ? `@${gitSource.ref}` : "";
      return `${scopePrefix}:git:${gitSource.host}/${gitSource.path}${ref}`;
    }

    return scopePrefix;
  }

  autocompleteDescription(
    description: string | undefined,
    sourceInfo?: sourceInfoTypes.SourceInfo,
  ): { description?: string } {
    const sourceTag = this.getAutocompleteSourceTag(sourceInfo);
    if (sourceTag === undefined || sourceTag === "") {
      return description === undefined ? {} : { description };
    }
    return {
      description:
        description !== undefined && description !== ""
          ? `[${sourceTag}] ${description}`
          : `[${sourceTag}]`,
    };
  }
}
