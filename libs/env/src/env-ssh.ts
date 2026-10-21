import hostKeyScan from "./host-key-scan.ts";
import knownHosts from "./known-hosts.ts";
import sshArgs from "./ssh-args.ts";
import sshModule from "./ssh.ts";

const envSsh = {
  acceptHostKey: knownHosts.acceptHostKey,
  connectSsh: sshModule.connectSsh,
  forgetHostKey: knownHosts.forgetHostKey,
  scanHostKey: hostKeyScan.scanHostKey,
  sshArguments: sshArgs.sshArguments,
  sshConnection: sshModule.sshConnection,
};

export default envSsh;
