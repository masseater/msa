const findSecrets = (text: string): Promise<string[]> =>
  import("./secret-check.ts").then((module) => module.default.findSecrets(text));

const secretCheckLazy = { findSecrets };

export default secretCheckLazy;
