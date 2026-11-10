import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { deferred, renderWithProviders } from "../render";

afterEach(() => vi.unstubAllGlobals());

test("password reset uses the auth request and prevents another submit while saving", async () => {
  const pending = deferred<Response>();
  const fetch = vi.fn().mockReturnValue(pending.promise);
  vi.stubGlobal("fetch", fetch);
  renderWithProviders(<ResetPasswordPage />);
  const user = userEvent.setup();

  await user.type(screen.getByLabelText("Recovery code"), "k".repeat(43));
  await user.type(screen.getByLabelText("New password"), "purpleblue4112");
  await user.click(screen.getByRole("button", { name: "Set new password" }));

  expect(screen.getByRole("button", { name: "Updating..." })).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe("/api/auth/reset-password");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    code: "k".repeat(43),
    password: "purpleblue4112",
  });

  pending.resolve(new Response(null, { status: 204 }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Password updated. Sign in again.",
  );
});

test("an expired reset code shows recovery advice and clears the password", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 400 })),
  );
  renderWithProviders(<ResetPasswordPage />);
  const user = userEvent.setup();

  await user.type(screen.getByLabelText("Recovery code"), "k".repeat(43));
  await user.type(screen.getByLabelText("New password"), "purpleblue4112");
  await user.click(screen.getByRole("button", { name: "Set new password" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This code is invalid or expired",
  );
  expect(screen.getByLabelText("New password")).toHaveValue("");
  expect(screen.getByLabelText("Recovery code")).toHaveValue("k".repeat(43));
});
