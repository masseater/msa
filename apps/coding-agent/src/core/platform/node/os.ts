import { arch, constants, homedir, platform, release, tmpdir, version } from "node:os";

const nodeOs = {
  arch,
  constants,
  homedir,
  platform,
  release,
  tmpdir,
  version,
};

export default nodeOs;
