import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { getDemoAccount, loginAccount } from "@/features/auth/api";
import { SecurityControls } from "@/features/members/SecurityControls";
import { LoginPage } from "@/pages/LoginPage";
import { deferred, renderWithProviders } from "../render";

vi.mock("@/features/auth/api", () => ({
  getDemoAccount: vi.fn(),
  loginAccount: vi.fn(),
  currentUserKey: ["auth", "me"],
}));

test("demo login fills the form and uses the normal sign in", async () => {
  const credentials = {
    email: "tyrone@example.org",
    password: "purpleblue4112",
  };
  const pending = deferred<Awaited<ReturnType<typeof loginAccount>>>();
  vi.mocked(getDemoAccount).mockResolvedValue(credentials);
  vi.mocked(loginAccount).mockReturnValue(pending.promise);

  renderWithProviders(<LoginPage />);

  const user = userEvent.setup();
  const demo = await screen.findByRole("button", {
    name: "Use demo admin account",
  });

  await user.click(demo);

  expect(screen.getByLabelText("Email")).toHaveValue(credentials.email);
  expect(screen.getByLabelText("Password")).toHaveValue(credentials.password);
  expect(loginAccount).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(vi.mocked(loginAccount).mock.calls[0][0]).toEqual(credentials);
  expect(demo).toBeDisabled();

  pending.resolve({
    id: "tyrone",
    email: credentials.email,
    is_admin: true,
    is_officer: true,
    membership_status: "approved",
  });

  expect(await screen.findByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("normal login stays available when demo access is disabled", async () => {
  vi.mocked(getDemoAccount).mockResolvedValue(null);

  renderWithProviders(<LoginPage />);

  await vi.waitFor(() => expect(getDemoAccount).toHaveBeenCalled());

  expect(
    screen.queryByRole("region", { name: "Demo access" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("protected demo accounts show an explanation instead of security controls", () => {
  renderWithProviders(
    <SecurityControls
      member={{
        id: "tyrone",
        email: "tyrone@example.org",
        is_admin: true,
        is_officer: true,
        is_suspended: false,
        security_revision: 1,
        membership_status: "approved",
        created_at: "2026-02-04T08:00:00Z",
        is_demo_account: true,
      }}
    />,
  );

  expect(
    screen.getByText(/password and account security settings are protected/),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Suspend account" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Issue recovery code" }),
  ).not.toBeInTheDocument();
});
