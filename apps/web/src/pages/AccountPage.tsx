import { Link } from "react-router";
import { useAccount } from "@/features/auth/use-account";

export function AccountPage() {
  const account = useAccount();
  const user = account.data;
  const labels = { pending: "Pending approval", approved: "Approved", revoked: "Revoked" };
  return <main className="page-shell page-narrow">
    <Link to="/" className="back-link">Home</Link>
    <h1 className="mt-4 page-title">Your account</h1>
    {account.isPending ? <p role="status" className="mt-6">Checking your account...</p> : account.isError ? <p role="alert" className="mt-6">{account.error.message}</p> : user && <dl className="mt-6 space-y-5 surface-panel">
      <div><dt className="supporting-copy">Email</dt><dd className="break-words">{user.email}</dd></div>
      <div><dt className="supporting-copy">Membership</dt><dd>{user.membership_status ? labels[user.membership_status] : "No membership"}</dd></div>
      <div><dt className="supporting-copy">Staff access</dt><dd>{[user.is_admin && "Admin", user.is_officer && "Officer"].filter(Boolean).join(", ") || "None"}</dd></div>
    </dl>}
    {user?.membership_status !== "approved" && <p className="mt-5 supporting-copy">Contact an administrator about your membership.</p>}
    <button className="mt-4 ui-button" disabled={account.isFetching} onClick={() => void account.refetch()}>Refresh membership status</button>
  </main>;
}
