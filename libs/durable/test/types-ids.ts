import ids from "../src/ids.ts";
import type durableTypes from "../src/index.types.ts";

const { idFromNumber, seqFromNumber } = ids;

const conversationId = idFromNumber<durableTypes.ConversationId>(1);
const entryId = idFromNumber<durableTypes.EntryId>(2);
const answerId = idFromNumber<durableTypes.EntryId>(3);
const taskId = idFromNumber<durableTypes.TaskId<number>>(4);
const submissionId = idFromNumber<durableTypes.SubmissionId>(5);
const documentId = idFromNumber<durableTypes.DocumentId>(6);
const seq = seqFromNumber(1);

const typesIds = { answerId, conversationId, documentId, entryId, seq, submissionId, taskId };

export default typesIds;
