import { idFromNumber, seqFromNumber } from "../src/ids.ts";
import type { ConversationId, DocumentId, EntryId, SubmissionId, TaskId } from "../src/index.ts";

const conversationId = idFromNumber<ConversationId>(1);
const entryId = idFromNumber<EntryId>(2);
const answerId = idFromNumber<EntryId>(3);
const taskId = idFromNumber<TaskId<number>>(4);
const submissionId = idFromNumber<SubmissionId>(5);
const documentId = idFromNumber<DocumentId>(6);
const seq = seqFromNumber(1);

const typesIds = { answerId, conversationId, documentId, entryId, seq, submissionId, taskId };

export default typesIds;
