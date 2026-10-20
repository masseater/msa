import { describe, expect, it } from "vite-plus/test";

import {
  type TodoItem,
  extractDoneSteps,
  markCompletedSteps,
} from "../examples/extensions/plan-mode/utils.ts";

const extractsSingleDoneMarker = () => {
  const message = "I've completed the first step [DONE:1]";
  expect(extractDoneSteps(message)).toEqual([1]);
};

const extractsMultipleDoneMarkers = () => {
  const message = "Did steps [DONE:1] and [DONE:2] and [DONE:3]";
  expect(extractDoneSteps(message)).toEqual([1, 2, 3]);
};

const handlesCaseInsensitivity = () => {
  const message = "[done:1] [DONE:2] [Done:3]";
  expect(extractDoneSteps(message)).toEqual([1, 2, 3]);
};

const returnsEmptyArrayWithNoMarkers = () => {
  const message = "No markers here";
  expect(extractDoneSteps(message)).toEqual([]);
};

const ignoresMalformedMarkers = () => {
  const message = "[DONE:abc] [DONE:] [DONE:1]";
  expect(extractDoneSteps(message)).toEqual([1]);
};

describe("extractDoneSteps", () => {
  it("extracts single DONE marker", extractsSingleDoneMarker);

  it("extracts multiple DONE markers", extractsMultipleDoneMarkers);

  it("handles case insensitivity", handlesCaseInsensitivity);

  it("returns empty array with no markers", returnsEmptyArrayWithNoMarkers);

  it("ignores malformed markers", ignoresMalformedMarkers);
});

const marksMatchingItemsAsCompleted = () => {
  const items: TodoItem[] = [
    { completed: false, step: 1, text: "First" },
    { completed: false, step: 2, text: "Second" },
    { completed: false, step: 3, text: "Third" },
  ];

  const count = markCompletedSteps("[DONE:1] [DONE:3]", items);

  expect(count).toBe(2);
  expect(items[0]?.completed).toBe(true);
  expect(items[1]?.completed).toBe(false);
  expect(items[2]?.completed).toBe(true);
};

const returnsCountOfCompletedItems = () => {
  const items: TodoItem[] = [{ completed: false, step: 1, text: "First" }];

  expect(markCompletedSteps("[DONE:1]", items)).toBe(1);
  expect(markCompletedSteps("no markers", items)).toBe(0);
};

const ignoresMarkersForNonExistentSteps = () => {
  const items: TodoItem[] = [{ completed: false, step: 1, text: "First" }];

  const count = markCompletedSteps("[DONE:99]", items);

  expect(count).toBe(1);
  expect(items[0]?.completed).toBe(false);
};

const doesnTDoubleCompleteAlreadyCompletedItems = () => {
  const items: TodoItem[] = [{ completed: true, step: 1, text: "First" }];

  markCompletedSteps("[DONE:1]", items);
  expect(items[0]?.completed).toBe(true);
};

describe("markCompletedSteps", () => {
  it("marks matching items as completed", marksMatchingItemsAsCompleted);

  it("returns count of completed items", returnsCountOfCompletedItems);

  it("ignores markers for non-existent steps", ignoresMarkersForNonExistentSteps);

  it("doesn't double-complete already completed items", doesnTDoubleCompleteAlreadyCompletedItems);
});
