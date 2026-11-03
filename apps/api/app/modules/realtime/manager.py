import asyncio
from collections import defaultdict
from typing import Literal
from uuid import UUID

Audience = Literal["guest", "officer"]


class PollNotifications:
    """Notifying connections in one process and grouping pending changes without storing them"""

    def __init__(self) -> None:
        self.listeners: dict[tuple[UUID, Audience], set[asyncio.Event]] = defaultdict(set)
        self.stopping = False

    def subscribe(self, meeting_id: UUID, audience: Audience) -> asyncio.Event:
        event = asyncio.Event()
        self.listeners[meeting_id, audience].add(event)

        return event

    def unsubscribe(self, meeting_id: UUID, audience: Audience, event: asyncio.Event) -> None:
        key = meeting_id, audience
        self.listeners[key].discard(event)

        if not self.listeners[key]:
            del self.listeners[key]

    def changed(self, meeting_id: UUID, *, officers_only: bool = False) -> None:
        # notifying only after changes are saved
        for audience in ("officer",) if officers_only else ("guest", "officer"):

            for event in self.listeners.get((meeting_id, audience), ()):
                event.set()

    def shutdown(self) -> None:
        self.stopping = True

        for events in self.listeners.values():
            for event in events:
                event.set()
