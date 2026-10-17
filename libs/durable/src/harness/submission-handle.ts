import type { Context } from "@msa/chord";

import type { AbortResult, Submissions } from "./submissions.ts";
import type { SettledSubmissionRecord, Submission, SubmissionRecord } from "./types.ts";

export class SubmissionHandle implements Submission {
  readonly id: SubmissionRecord["id"];
  readonly #submissions: Submissions;

  constructor(id: SubmissionRecord["id"], submissions: Submissions) {
    this.id = id;
    this.#submissions = submissions;
  }

  status(context: Context): Promise<SubmissionRecord> {
    return this.#submissions.status(this.id, context);
  }

  wait(context: Context): Promise<SettledSubmissionRecord> {
    return this.#submissions.wait(this.id, context);
  }

  abort(context: Context): Promise<AbortResult> {
    return this.#submissions.abortHandle(this.id, context);
  }
}
