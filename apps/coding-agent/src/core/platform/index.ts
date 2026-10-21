import platformConsole from "./console.ts";
import platformCrypto from "./crypto.ts";
import effectInterop from "./effect-interop.ts";
import platformEnv from "./env.ts";
import platformFiles from "./files.ts";
import ForeignError from "./foreign-error.ts";
import nodeSea from "./node/sea.ts";
import platformPath from "./path.ts";
import platformTime from "./time.ts";
import ToolFailure from "./tool-failure.ts";

const platform = {
  ...platformConsole,
  ...platformCrypto,
  ...effectInterop,
  ...platformEnv,
  ...platformPath,
  ...platformTime,
  ForeignError,
  ToolFailure,
  files: platformFiles,
  isSea: nodeSea.isSea,
};

export default platform;
