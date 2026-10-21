import deploy from "./deploy.ts";
import detect from "./detect.ts";
import remoteInfo from "./remote-info.ts";

const envDaemon = {
  deployDaemon: deploy.deployDaemon,
  detectPlatform: detect.detectPlatform,
  localDaemon: deploy.localDaemon,
  nodePlatform: remoteInfo.nodePlatform,
  packagedDaemon: deploy.packagedDaemon,
};

export default envDaemon;
