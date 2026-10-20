import type { Context } from "@msa/chord";

import type submissionsTypes from "./submissions.types.ts";
import type typesModule from "./types.types.ts";

export default class SubmissionHandle implements typesModule.Submission {
  readonly id: typesModule.SubmissionRecord["id"];
  readonly #submissions: submissionsTypes.Submissions;

  constructor(id: typesModule.SubmissionRecord["id"], submissions: submissionsTypes.Submissions) {
    this.id = id;
    this.#submissions = submissions;
  }

  status(context: Context): Promise<typesModule.SubmissionRecord> {
    return this.#submissions.status(this.id, context);
  }

  wait(context: Context): Promise<typesModule.SettledSubmissionRecord> {
    return this.#submissions.wait(this.id, context);
  }

  abort(context: Context): Promise<submissionsTypes.AbortResult> {
    return this.#submissions.abortHandle(this.id, context);
  }
}
