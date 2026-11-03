import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { apiRequest } from "@/lib/api";
import { inputClass, actionButtonClass as button } from "@/components/ui/control-styles";

export function ResetPasswordPage() {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return;
    setPending(true); setError("");
    try {
      const response = await apiRequest("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim(), password }) });
      if (!response.ok) throw new Error(response.status === 400 ? "This code is invalid or expired. Ask an admin for a new one." : "The reset could not be confirmed. Try signing in with the new password before requesting another code.");
      setCode(""); setDone(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Reset could not be confirmed."); }
    finally { setPassword(""); setPending(false); }
  }
  return <main className="page-shell page-auth">
    <Link to="/login" className="back-link">Back to sign in</Link>
    <h1 className="mt-4 page-title">Recover your account</h1>
    <p className="page-intro">Ask an administrator for a recovery code.</p>
    {done ? <div className="mt-6 surface-panel"><p role="status">Password updated. Sign in again.</p><Link to="/login" className="mt-4 ui-button">Sign in</Link></div> : <form className="mt-6 space-y-4 surface-panel" onSubmit={submit}>
      <label className="block text-sm font-medium">Recovery code<input className={`${inputClass} mt-2`} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required minLength={43} maxLength={43} disabled={pending} /></label>
      <label className="block text-sm font-medium">New password<input className={`${inputClass} mt-2`} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} disabled={pending} /></label>
      <p className="supporting-copy">Use 12–128 characters for your new password.</p>
      <button className={`${button} ui-button-primary w-full`} disabled={pending}>{pending ? "Updating..." : "Set new password"}</button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>}
  </main>;
}
