import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { GuestPollsPanel } from "@/features/ballots/GuestPollsPanel";
import { getGuestPolls, submitPollResponse } from "@/features/ballots/poll-api";
import { deferred, renderWithProviders } from "../render";

vi.mock("@/features/ballots/poll-api", () => ({
  getGuestPolls: vi.fn(),
  submitPollResponse: vi.fn(),
}));
vi.mock("@/features/ballots/use-live-polls", () => ({
  useLivePolls: () => "Live updates connected",
}));

function poll(state: "OPEN" | "CLOSED" = "OPEN") {
  return {
    id: "poll",
    question: "Pick two",
    description: "",
    kind: "poll_multiple" as const,
    state,
    min_selections: 2,
    max_selections: 2,
    submitted: false,
    participation_count: 0,
    options: ["Tyrone", "Shan", "Jonny"].map((label) => ({
      id: label,
      label,
      count: 0,
    })),
  };
}

test("selection limits and pending submission prevent invalid or duplicate clicks", async () => {
  vi.mocked(getGuestPolls).mockResolvedValue({ items: [poll()], total: 1 });

  const pending = deferred<Awaited<ReturnType<typeof submitPollResponse>>>();
  vi.mocked(submitPollResponse).mockReturnValue(pending.promise);
  renderWithProviders(<GuestPollsPanel meetingId="meeting" />);
  const user = userEvent.setup();

  const submit = await screen.findByRole("button", { name: "Submit response" });

  expect(submit).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "Tyrone" }));
  expect(submit).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "Shan" }));

  expect(submit).toBeEnabled();
  await user.click(screen.getByRole("checkbox", { name: "Jonny" }));

  expect(submit).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "Jonny" }));
  await user.click(submit);

  expect(screen.getByRole("button", { name: /Submitting/ })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Tyrone" })).toBeDisabled();

  expect(submitPollResponse).toHaveBeenCalledTimes(1);
  expect(vi.mocked(submitPollResponse).mock.calls[0]).toEqual([
    "meeting",
    "poll",
    ["Tyrone", "Shan"],
  ]);

  await act(async () => {
    pending.resolve({ submitted: true });
  });
  expect(
    await screen.findByText(/Your response has been recorded/),
  ).toBeVisible();

  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

test("closed polls show totals but no submission controls", async () => {
  vi.mocked(getGuestPolls).mockResolvedValue({
    items: [poll("CLOSED")],
    total: 1,
  });

  renderWithProviders(<GuestPollsPanel meetingId="meeting" />);
  expect(
    await screen.findByText("This poll is closed or the meeting has ended."),
  ).toBeVisible();

  expect(
    screen.queryByRole("button", { name: "Submit response" }),
  ).not.toBeInTheDocument();

  expect(
    within(screen.getByRole("region", { name: "Guest polls" })).getByText(
      "Responses:",
    ),
  ).toBeVisible();
});
