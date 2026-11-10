import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { draftSaveError } from "@/features/ballots/draft-save-error";
import { MeetingRequestError } from "@/features/meetings/api";
import { RequestConnectionError } from "@/lib/api";
import { useCreationAttempt } from "@/lib/use-creation-attempt";

test("an uncertain save offers a retry with the same key and original entries", async () => {
  const { result } = renderHook(() =>
    useCreationAttempt<{ question: string }>(),
  );
  const attempt = result.current;
  const input = { question: "Choose a chair" };
  const send = vi
    .fn()
    .mockRejectedValueOnce(new RequestConnectionError("timeout"))
    .mockResolvedValueOnce({ id: "saved-draft" });
  let message = "";

  await act(async () => {
    try {
      await attempt.run(input, send);
    } catch (error) {
      message = draftSaveError(error as Error, false, !!attempt.retryInput);
    }
  });

  expect(message).toContain("Retry below");
  expect(message).not.toContain("Cancel editing");

  await act(async () => {
    await attempt.run(attempt.retryInput!, send);
  });

  expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  expect(attempt.retryInput).toBeNull();
});

test("a rejected new draft keeps the form without offering an uncertain retry", async () => {
  const { result } = renderHook(() =>
    useCreationAttempt<{ question: string }>(),
  );
  const attempt = result.current;
  const send = vi
    .fn()
    .mockRejectedValue(new MeetingRequestError("Check the options.", 422));
  let message = "";

  await act(async () => {
    try {
      await attempt.run({ question: "Choose a chair" }, send);
    } catch (error) {
      message = draftSaveError(error as Error, false, !!attempt.retryInput);
    }
  });

  expect(message).toContain("Check the options.");
  expect(message).not.toContain("Retry below");
  expect(message).not.toContain("Cancel editing");
  expect(attempt.retryInput).toBeNull();
});

test("only an edit conflict asks the user to reload the draft", () => {
  const conflict = new MeetingRequestError("This draft changed.", 409);

  expect(draftSaveError(conflict, true, false)).toContain("Cancel editing");
  expect(draftSaveError(conflict, false, false)).not.toContain(
    "Cancel editing",
  );
  expect(
    draftSaveError(new RequestConnectionError("network"), true, false),
  ).not.toContain("Cancel editing");
});
