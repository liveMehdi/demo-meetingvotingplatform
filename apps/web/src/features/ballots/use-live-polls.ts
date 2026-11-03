import { z } from "zod";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const pollMessageSchema = z.object({
  type: z.enum(["ready", "polls.changed", "heartbeat"]),
});

type LiveStatus = "connecting" | "live" | "reconnecting" | "unavailable";

export function useLivePolls(meetingId: string, audience: "guest" | "officer") {
  const client = useQueryClient();

  const [status, setStatus] = useState<LiveStatus>("connecting");
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      if (disposed || refreshTimer !== undefined) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;

        if (disposed) return;
        void client.invalidateQueries({
          predicate: (query) =>
            query.queryKey[1] === meetingId &&
            (audience === "guest"
              ? ["guest-polls", "guest-meeting"].includes(
                  String(query.queryKey[0]),
                )
              : [
                  "polls",
                  "poll-totals",
                  "poll-presentation",
                  "guest-joining",
                  "meeting",

                  "meeting-history",
                  "ballots",
                  "published-results",
                  "attendance",
                  "attendance-history",
                  "nomination-contests",
                ].includes(String(query.queryKey[0]))),
        });
      }, 200);
    };

    const connect = () => {
      if (disposed) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const url = new URL(
        `/ws/${audience}/meetings/${encodeURIComponent(meetingId)}/polls`,
        window.location.href,
      );
      url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const current = new WebSocket(url);
      socket = current;

      const armWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => current.close(), 45000);
      };
      armWatchdog();
      current.onmessage = (event: MessageEvent<string>) => {
        if (disposed || socket !== current) return;
        let message: unknown;

        try {
          message = JSON.parse(event.data);
        } catch {
          current.close();
          return;
        }

        const parsed = pollMessageSchema.safeParse(message);
        if (!parsed.success) return;
        const type = parsed.data.type;

        if (type === "ready") {
          attempt = 0;
          setStatus("live");
          armWatchdog();

          refresh();
        } else if (type === "polls.changed") {
          armWatchdog();

          refresh();
        } else if (type === "heartbeat") {
          armWatchdog();
        }
      };

      current.onclose = (event) => {
        if (disposed || socket !== current) return;
        clearTimeout(watchdog);
        socket = null;
        refresh(); // Also discard stale authorised UI after expiry/logout/revocation.
        if (event.code === 1008) {
          setStatus("unavailable");
          return;
        }
        setStatus("reconnecting");
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5));
        retry = setTimeout(connect, delay + Math.random() * 250);
      };
      current.onerror = () => current.close();
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearTimeout(watchdog);
      clearTimeout(refreshTimer);
      socket?.close();
    };
  }, [audience, client, meetingId]);

  return status === "live"
    ? "Live updates connected"
    : status === "connecting"
      ? "Connecting live updates…"
      : status === "reconnecting"
        ? "Reconnecting live updates…"
        : "Live updates unavailable. Refresh to check access.";
}
