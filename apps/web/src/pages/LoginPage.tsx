import { inputClass } from "@/components/ui/control-styles";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { currentUserKey, loginAccount } from "@/features/auth/api";

import { safeReturnTo } from "@/lib/navigation";

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const destination = safeReturnTo(params.get("returnTo"));
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const login = useMutation({
    mutationFn: loginAccount,
    retry: false,
    networkMode: "always",
    gcTime: 0,
    async onSuccess(user) {
      setPassword("");
      await queryClient.cancelQueries();
      queryClient.clear();
      queryClient.setQueryData(currentUserKey, user);
      login.reset();
      navigate(destination, { replace: true });
    },
    onError(error) {
      setFeedback(error.message);
      setPassword("");
      login.reset();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (login.isPending) return;
    setFeedback(null);
    login.mutate({ email: email.trim(), password });
  }

  return (
    <main className="page-shell page-auth">
      <Link to="/" className="back-link">Back to home</Link>
      <h1 className="mt-4 mb-6 page-title">Welcome back</h1>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-5" aria-busy={login.isPending}>
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium">Email</label>
              <input
                id="email" name="email" type="email" autoComplete="username" autoCapitalize="none"
                required maxLength={254} value={email} disabled={login.isPending}
                onChange={(event) => setEmail(event.target.value)}
                className={`${inputClass}`}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-medium">Password</label>
              <input
                id="password" name="password" type="password" autoComplete="current-password"
                required maxLength={128} value={password} disabled={login.isPending}
                onChange={(event) => setPassword(event.target.value)}
                className={`${inputClass}`}
              />
            </div>
            {feedback && <p role="alert" className="text-sm text-destructive">{feedback}</p>}
            <button
              type="submit" disabled={login.isPending}
              className="w-full ui-button ui-button-primary"
            >
              {login.isPending ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <Link to="/reset-password" className="mt-5 block text-sm underline">Need help recovering your account?</Link>
          <Link to={`/register?returnTo=${encodeURIComponent(destination)}`} className="mt-6 inline-block text-sm underline underline-offset-4">
            Need an account? Register
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
