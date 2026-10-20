import FooterDataProviderLayer2 from "./footer-data-provider-layer-2.ts";
import footerDataProviderSupport from "./footer-data-provider-support.ts";

const { findGitPaths } = footerDataProviderSupport;

export default class FooterDataProvider extends FooterDataProviderLayer2 {
  constructor(cwd: string) {
    super();
    this.cwd = cwd;
    this.gitPaths = findGitPaths(cwd);
    this.setupGitWatcher();
  }
}
