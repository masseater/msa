interface MergeRequest {
  number: string | undefined;
  method: string | undefined;
  sha: string;
  subject: string;
  body: string;
}

function mergeRequestOf(args: readonly string[]): MergeRequest {
  const fields = new Map(
    args.flatMap((arg, index) => {
      if (args[index - 1] !== "-f") return [];
      const at = arg.indexOf("=");
      return [[arg.slice(0, at), arg.slice(at + 1)] as const];
    }),
  );
  return {
    body: fields.get("commit_message") ?? "",
    method: fields.get("merge_method"),
    number: /^repos\/\{owner\}\/\{repo\}\/pulls\/(\d+)\/merge$/u.exec(
      args.find((arg) => arg.startsWith("repos/")) ?? "",
    )?.[1],
    sha: fields.get("sha") ?? "",
    subject: fields.get("commit_title") ?? "",
  };
}

const fakeGitHubMerge = { mergeRequestOf };

export default fakeGitHubMerge;
