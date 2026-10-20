import { Data } from "effect";

export default class BudgetExceeded extends Data.TaggedError("BudgetExceeded")<{
  readonly message: string;
}> {}
