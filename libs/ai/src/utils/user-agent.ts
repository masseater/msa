import runtime from "./runtime.ts";

const { isNodeRuntime } = runtime;

function getMsaUserAgent(): string {
  return isNodeRuntime() ? `pi (${process.platform}; ${process.arch})` : "pi (browser)";
}

const userAgent = {
  getMsaUserAgent,
};

export default userAgent;
