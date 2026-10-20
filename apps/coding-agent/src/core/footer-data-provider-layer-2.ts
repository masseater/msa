import FooterDataProviderLayer1 from "./footer-data-provider-layer-1.ts";
import footerDataProviderSupport from "./footer-data-provider-support.ts";

const { findGitPaths } = footerDataProviderSupport;

export default abstract class FooterDataProviderLayer2 extends FooterDataProviderLayer1 {
  setCwd(cwd: string): void {
    if (this.cwd === cwd) {
      return;
    }

    this.cwd = cwd;
    if (this.refreshTimer !== null) {
      this.refreshTimer.cancel();
      this.refreshTimer = null;
    }
    this.clearGitWatchers();
    this.cachedBranch = undefined;
    this.gitPaths = findGitPaths(cwd);
    this.setupGitWatcher();
    this.notifyBranchChange();
  }
}
