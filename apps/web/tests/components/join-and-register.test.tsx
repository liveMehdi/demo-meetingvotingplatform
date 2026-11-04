import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { JoinMeetingForm } from "@/features/meetings/JoinMeetingForm";
import { joinMeeting } from "@/features/meetings/guest-api";
import { registerAccount } from "@/features/auth/api";
import { RegisterPage } from "@/pages/RegisterPage";
import { renderWithProviders } from "../render";

vi.mock("@/features/meetings/guest-api", () => ({ joinMeeting: vi.fn() }));
vi.mock("@/features/auth/api", () => ({ registerAccount: vi.fn() }));

test("invalid meeting codes are blocked, valid codes normalised, and errors displayed", async () => {
  vi.mocked(joinMeeting).mockRejectedValue(
    new Error("Meeting code unavailable"),
  );

  renderWithProviders(<JoinMeetingForm />);

  const user = userEvent.setup();

  const input = screen.getByLabelText("Meeting code");
  await user.type(input, "INVALID987");
  await user.click(screen.getByRole("button", { name: "Join meeting" }));

  expect(input).toBeInvalid();
  expect(joinMeeting).not.toHaveBeenCalled();
  await user.clear(input);

  await user.type(input, "abcdefgh24");
  expect(input).toHaveValue("ABCDEFGH24");
  await user.click(screen.getByRole("button", { name: "Join meeting" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Meeting code unavailable",
  );

  expect(vi.mocked(joinMeeting).mock.calls[0][0]).toBe("ABCDEFGH24");

  await user.clear(input);

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("registration errors are shown and the password is cleared", async () => {
  vi.mocked(registerAccount).mockRejectedValue(
    new Error("Email already registered"),
  );

  renderWithProviders(<RegisterPage />);

  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "jonny@example.org");
  await user.type(screen.getByLabelText("Password"), "orangegreen904");
  await user.click(screen.getByRole("button", { name: "Create account" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Email already registered",
  );

  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(screen.getByLabelText("Email")).toHaveValue("jonny@example.org");
});
