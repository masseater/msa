import Transaction from "../session/transaction.ts";
import ids from "../types/ids.ts";

const SCAN_PAGE_SIZE = 256;
const MAX_TIMER_DELAY = 2_147_483_647;
const LIVE_STATUSES = ["pending", "running", "waiting", "completing"] as const;

const schedulerTypes = {
  LIVE_STATUSES,
  MAX_TIMER_DELAY,
  ROOT_CONVERSATION_ID: ids.ROOT_CONVERSATION_ID,
  SCAN_PAGE_SIZE,
  Transaction: Transaction,
};

export default schedulerTypes;
