declare namespace promptUrlWidgetTypes {
  type PromptMatch = {
    kind: "pr" | "issue" | "advisory";
    target: string;
  };

  type GhMetadata = {
    title?: string | undefined;
    detail?: string | undefined;
    displayUrl?: string;
    author?: {
      login?: string;
      name?: string | null;
    };
  };

  type GitHubAdvisoryMetadata = {
    ghsa_id?: string;
    summary?: string;
    severity?: string;
    state?: string;
    html_url?: string;
    cve_id?: string | null;
  };

  type AdvisoryRef = {
    owner: string;
    repo: string;
    ghsaId: string;
    url: string;
  };

  type UserContent = string | { type: string; text?: string }[] | undefined;
}

export type { promptUrlWidgetTypes as default };
