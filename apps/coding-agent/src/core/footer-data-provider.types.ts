import type FooterDataProviderClass from "./footer-data-provider.ts";

declare namespace footerDataProviderTypes {
  type GitPaths = {
    repoDir: string;
    commonGitDir: string;
    headPath: string;
  };

  type ReadonlyFooterDataProvider = Pick<
    FooterDataProvider,
    "getGitBranch" | "getExtensionStatuses" | "getAvailableProviderCount" | "onBranchChange"
  >;

  type FooterDataProvider = (typeof FooterDataProviderClass)["prototype"];
}

export type { footerDataProviderTypes as default };
