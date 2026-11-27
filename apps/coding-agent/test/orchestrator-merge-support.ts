import { Effect } from "effect";

function rejection(attempt: () => Promise<unknown>) {
  return Effect.promise(() =>
    attempt().then(
      () => "",
      (error: unknown) => String(error),
    ),
  );
}

const orchestratorMergeSupport = {
  rejection,
};

export default orchestratorMergeSupport;
