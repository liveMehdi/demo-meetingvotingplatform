import { inputClass } from "@/components/ui/control-styles";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { registerAccount, type RegistrationResult } from "@/features/auth/api";

import { safeReturnTo, loginUrl } from "@/lib/navigation";

export function RegisterPage() {
  const [params] = useSearchParams();
  const signIn = loginUrl(safeReturnTo(params.get("returnTo")));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [registered, setRegistered] = useState<RegistrationResult | null>(null);

  const registration = useMutation({
    mutationFn: registerAccount,
    retry: false,
    networkMode: "always",
    gcTime: 0,
    onSuccess(result) {
      setRegistered(result);
      setPassword("");
      // Clear submitted credentials from the mutation observer/cache as well as the form.
      registration.reset();
    },
    onError(error) {
      setFeedback(error.message);
      setPassword("");
      registration.reset();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (registration.isPending) return;
    setFeedback(null);
    registration.mutate({ email: email.trim(), password });
  }

  return (
    <main className="page-shell page-auth">
      <Link to="/" className="back-link">
        Back to home
      </Link>
      <h1 className="mt-4 mb-6 page-title">Join your organisation</h1>
      {registered ? (
        <Card>
          <CardHeader>
            <CardTitle>Account created</CardTitle>
            <CardDescription>{registered.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <p role="status" className="leading-7">
              Your account is ready. Membership approval is pending.
            </p>
            <Link
              to={signIn}
              className="mt-4 inline-block text-sm underline underline-offset-4"
            >
              Continue to sign in
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Create an account</CardTitle>
            <CardDescription>
              Membership requires administrator approval.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={submit}
              className="space-y-5"
              aria-busy={registration.isPending}
            >
              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  maxLength={254}
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={registration.isPending}
                  className={`${inputClass}`}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  aria-describedby="password-help"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={registration.isPending}
                  className={`${inputClass}`}
                />
                <p id="password-help" className="supporting-copy">
                  Use 12–128 characters. A long, unique passphrase works well.
                </p>
              </div>
              {feedback && (
                <p role="alert" className="text-sm text-destructive">
                  {feedback}
                </p>
              )}
              <button
                type="submit"
                disabled={registration.isPending}
                className="w-full ui-button ui-button-primary"
              >
                {registration.isPending
                  ? "Creating account…"
                  : "Create account"}
              </button>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
