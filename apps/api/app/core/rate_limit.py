"""Limit repeated login, signup, password reset and guest join attempts."""

import math
import time


class RequestLimiter:
    policies = {
        "/api/auth/login": (30, 60),
        "/api/auth/register": (10, 600),
        "/api/auth/reset-password": (10, 600),
        "/api/guest/join": (60, 60),
    }

    def __init__(self, capacity: int = 10000):
        self.capacity = capacity
        # they reset when the server restarts
        self.windows: dict[tuple[str, str], tuple[int, float]] = {}

    def retry_after(self, path: str, host: str, now: float | None = None) -> int:
        if path not in self.policies:
            return 0
        now = time.monotonic() if now is None else now
        limit, seconds = self.policies[path]
        key = (path, host)
        count, end = self.windows.get(key, (0, now + seconds))
        if end <= now:
            count, end = 0, now + seconds
        if key not in self.windows and len(self.windows) >= self.capacity:
            self.windows = {k: v for k, v in self.windows.items() if v[1] > now}
            if len(self.windows) >= self.capacity:
                return max(1, math.ceil(min(v[1] for v in self.windows.values()) - now))
        if count >= limit:
            return max(1, math.ceil(end - now))
        self.windows[key] = (count + 1, end)
        return 0
