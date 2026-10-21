function getMsaUserAgent(version: string): string {
  const runtime =
    process.versions["bun"] !== undefined && process.versions["bun"] !== ""
      ? `bun/${process.versions["bun"]}`
      : `node/${process.version}`;
  return `pi/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}

const userAgent = {
  getMsaUserAgent,
};

export default userAgent;
