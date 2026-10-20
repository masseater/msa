import contract from "./contract.ts";
import errors from "./errors.ts";
import reloadCandidate from "./reload-candidate.ts";
import schema from "./schema.ts";

const reloadPrepareKit = {
  contract,
  errors,
  reloadCandidate,
  schema,
};

export default reloadPrepareKit;
