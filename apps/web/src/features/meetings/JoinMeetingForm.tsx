import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { joinMeeting } from "./guest-api";

export function JoinMeetingForm({
  initialCode = "",
}: {
  initialCode?: string;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();

  const [code, setCode] = useState(initialCode);

  const join = useMutation({
    mutationFn: joinMeeting,
    retry: false,
    gcTime: 0,
    networkMode: "always",
    onSuccess(meeting) {
      client.removeQueries({ queryKey: ["guest-meeting"] });
      navigate(`/guest/meetings/${meeting.meeting_id}`, { replace: true });
    },
  });

  return (
    <>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!join.isPending) join.mutate(code);
        }}
      >
        <label className="block text-sm font-medium">
          Meeting code
          <input
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            minLength={10}
            maxLength={10}
            pattern="[A-Ha-hJ-Nj-nP-Zp-z2-9]{10}"
            value={code}
            disabled={join.isPending}
            onChange={(event) => {
              setCode(event.target.value.trim().toUpperCase());
              join.reset();
            }}
            className="mt-2 ui-input font-mono tracking-wider"
          />
        </label>
        <button disabled={join.isPending} className="ui-button w-full">
          {join.isPending ? "Joining…" : "Join meeting"}
        </button>
        {join.isError && (
          <p role="alert" className="text-sm text-destructive">
            {join.error.message}
          </p>
        )}
      </form>
    </>
  );
}
