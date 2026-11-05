import { z } from "zod";
import { readResponse, readErrorDetail } from "@/lib/validation";
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { currentUserKey, type CurrentUser } from "@/features/auth/api";
import type { Member } from "./api";
import { actionButtonClass as button } from "@/components/ui/control-styles";

const securityResultSchema = z.union([
  z.object({ reset_code: z.string(), expires_at: z.string() }),
  z.object({ reset_code: z.null(), expires_at: z.null() }),
]);

const labels = {
  suspend: "Suspend account",
  restore: "Restore account",
  grant_admin: "Grant admin access",
  remove_admin: "Remove admin access",
  revoke_sessions: "Sign out all sessions",
  issue_reset: "Issue recovery code",
};
type Action = keyof typeof labels;

export function SecurityControls({ member }: { member: Member }) {

  const client = useQueryClient();
  const isSelf =
    client.getQueryData<CurrentUser>(currentUserKey)?.id === member.id;

  const [review, setReview] = useState<Action | null>(null);
  const [code, setCode] = useState<{
    reset_code: string;
    expires_at: string;
  } | null>(null);

  const [message, setMessage] = useState("");
  const change = useMutation({
    retry: false,
    gcTime: 0,
    networkMode: "always",

    mutationFn: async (action: Action) => {

      const response = await apiRequest(
        `/api/members/${encodeURIComponent(member.id)}/security`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            expected_revision: member.security_revision,
          }),
        },

      );
      if (!response.ok) {
        throw new Error(
          (await readErrorDetail(response)) ?? "Account update could not be confirmed. Refresh first.",
        );
      }
      return readResponse(response, securityResultSchema,
        "Account update could not be confirmed. Refresh first.");
    },
    async onSuccess(data) {
      setReview(null);
      setMessage("Account controls updated.");
      setCode(
        data.reset_code
          ? { reset_code: data.reset_code, expires_at: data.expires_at }
          : null,
      );

      await client.invalidateQueries({ queryKey: ["members"] });
      await client.invalidateQueries({ queryKey: ["auth", "me"] });

      change.reset();
    },
    async onError(error) {
      setReview(null);
      setMessage(error.message);
      await client.invalidateQueries({ queryKey: ["members"] });

      change.reset();
    },
  });
  if (member.is_demo_account) {
    return <p className="mt-5 supporting-copy">
      Shared demo admin — password and account security settings are protected.
    </p>;
  }

  return (
    <details className="mt-5 border-t pt-4">
      <summary className="cursor-pointer text-sm">
        Account security {member.is_suspended ? "· Suspended" : ""}
      </summary>

      <div className="mt-3 action-row">
        {(
          [
            member.is_suspended ? "restore" : "suspend",
            member.is_admin ? "remove_admin" : "grant_admin",
            "revoke_sessions",
            "issue_reset",
          ] as Action[]

        ).map((action) => (
          <button
            key={action}
            className={button}
            disabled={
              change.isPending ||
              (action === "issue_reset" && (member.is_suspended || isSelf))
            }
            onClick={() => {
              setReview(action);
              setCode(null);
              setMessage("");
            }}
          >
            {labels[action]}
          </button>
        ))}

      </div>

      {isSelf && (
        <p className="mt-3 supporting-copy">
          Ask another admin if you need a recovery code.
        </p>
      )}

      {review && (
        <div
          role="region"
          aria-label="Confirm account security change"
          className="mt-4 surface-inset"
        >

          <p>
            {labels[review]} for {member.email}?
          </p>

          {review === "suspend" && (
            <p className="mt-2 text-sm">
              This signs them out and blocks account access. Membership,
              existing voting eligibility and recorded votes are retained.
            </p>
          )}

          {(review === "suspend" || review === "remove_admin") && (
            <p className="mt-2 text-sm">
              At least one active admin must remain.
            </p>
          )}

          {review === "issue_reset" && (
            <p className="mt-2 text-sm">
              Verify this member’s identity outside the app first. This signs
              out their sessions and replaces any earlier code. Give the code
              only to that verified member; it expires after 15 minutes.
            </p>
          )}

          <div className="mt-3 action-row">
            <button
              className={button}
              disabled={change.isPending}
              onClick={() => change.mutate(review)}
            >
              Confirm
            </button>

            <button
              className={button}
              disabled={change.isPending}
              onClick={() => setReview(null)}
            >
              Cancel
            </button>

          </div>
        </div>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
      {code && (
        <div className="mt-3 surface-inset">
          <p className="text-sm">
            Shown only once. The member enters this code on{" "}
            <Link className="underline" to="/reset-password">
              Account recovery
            </Link>
            .
          </p>
          
          <code className="my-3 block select-all break-all">
            {code.reset_code}
          </code>
          <p className="text-sm">
            Expires: {new Date(code.expires_at).toLocaleString()}
          </p>
          <button className={`${button} mt-3`} onClick={() => setCode(null)}>
            Hide code
          </button>
        </div>
      )}
    </details>
  );
}
