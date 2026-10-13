from typing import Protocol

from onholidai_agent.models.api import CreateAgentRunRequest


class TripReader(Protocol):
    async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]: ...


async def get_trip(reader: TripReader, request: CreateAgentRunRequest) -> dict[str, object]:
    trip = await reader.get_trip(request)
    if trip.get("version") != request.actor.base_trip_version:
        raise ValueError("trip_version_conflict")
    return trip
