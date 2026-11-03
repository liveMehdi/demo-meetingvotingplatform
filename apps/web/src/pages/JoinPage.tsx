import { Link } from "react-router";
import { JoinMeetingForm } from "@/features/meetings/JoinMeetingForm";

export function JoinPage() {
  return <main className="page-shell page-auth">
    <Link to="/" className="back-link">Home</Link>
    <h1 className="mt-4 page-title">Join a meeting</h1>
    <p className="page-intro">Enter your organiser’s code. No account required.</p>
    <div className="mt-6 surface-panel"><JoinMeetingForm initialCode={window.location.hash.slice(1)} /></div>
  </main>;
}
