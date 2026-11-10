import { z } from "zod";
import { readResponse } from "@/lib/validation";
import { ApiRequestError, apiRequest, blockedRequestMessage } from "@/lib/api";

export interface RegistrationInput {
  email: string;
  password: string;
}

export const registrationResultSchema = z.object({
  id: z.string(),
  email: z.string(),
  membership_status: z.literal("pending"),
});

export type RegistrationResult = z.infer<typeof registrationResultSchema>;

export const currentUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  is_admin: z.boolean(),
  is_officer: z.boolean(),
  membership_status: z.enum(["pending", "approved", "revoked"]).nullable(),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;

export const currentUserKey = ["auth", "me"] as const;

const demoAccountSchema = z
  .object({ email: z.string().email(), password: z.string() })
  .nullable();

export async function getDemoAccount(signal: AbortSignal) {
  const response = await apiRequest("/api/auth/demo", { signal });

  if (!response.ok) throw new Error("Demo access is unavailable.");

  return readResponse(
    response,
    demoAccountSchema,
    "Demo access could not be loaded.",
  );
}

async function readCurrentUser(response: Response): Promise<CurrentUser> {
  return readResponse(
    response,
    currentUserSchema,
    "The server returned an unexpected account response.",
  );
}

export async function getCurrentUser(
  signal: AbortSignal,
): Promise<CurrentUser | null> {
  const response = await apiRequest("/api/auth/me", { signal });

  if (response.status === 401) return null;

  if (!response.ok)
    throw new Error("Your account could not be loaded. Please try again.");

  return readCurrentUser(response);
}

export async function loginAccount(
  input: RegistrationInput,
): Promise<CurrentUser> {
  const response = await apiRequest("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (response.status === 401) throw new Error("Invalid email or password.");

  if (response.status === 422)
    throw new Error("Enter a valid email and password.");

  if (response.status === 403) throw new Error(blockedRequestMessage);

  if (!response.ok)
    throw new Error("Sign-in is temporarily unavailable. Please try again.");

  return readCurrentUser(response);
}

export async function logoutAccount(): Promise<void> {
  const response = await apiRequest("/api/auth/logout", { method: "POST" });

  if (response.status === 403) throw new Error(blockedRequestMessage);

  if (response.status !== 204) {
    throw new Error("Sign-out could not be confirmed. Please try again.");
  }
}

export async function resetPassword(input: {
  code: string;
  password: string;
}): Promise<void> {
  const response = await apiRequest("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(
      response.status === 400
        ? "This code is invalid or expired. Ask an admin for a new one."
        : "The reset could not be confirmed. Try signing in with the new password before requesting another code.",
    );
  }
}

export async function registerAccount(
  input: RegistrationInput,
): Promise<RegistrationResult> {
  let response: Response;

  try {
    response = await apiRequest("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;

    throw new Error(
      "We couldn't confirm registration. Check your connection and try again. " +
        "If your email is already registered, the first request may have succeeded.",
    );
  }

  if (response.status === 403) throw new Error(blockedRequestMessage);

  if (response.status === 409) {
    throw new Error("An account with this email already exists.");
  }

  if (response.status === 422) {
    throw new Error(
      "Enter a valid email and a password between 12 and 128 characters.",
    );
  }

  if (!response.ok) {
    throw new Error(
      "Registration is temporarily unavailable. Please try again.",
    );
  }

  return readResponse(
    response,
    registrationResultSchema,
    "Registration could not be confirmed because the server response was unexpected.",
  );
}
