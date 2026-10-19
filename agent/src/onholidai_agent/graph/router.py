from typing import cast

from onholidai_agent.api.store import RunStore
from onholidai_agent.graph.estimate import Sources
from onholidai_agent.integrations.runtime import EstimateSources, supplier_research
from onholidai_agent.models.api import AgentResult, CreateAgentRunRequest

from .refine import dispatch as planning_dispatch

__all__ = ["dispatch"]


async def dispatch(request: CreateAgentRunRequest, sources: Sources) -> AgentResult:
    if request.purpose == "supplier_research":
        store = sources.store if isinstance(sources, EstimateSources) else cast(RunStore, sources)
        return await supplier_research(request, store)
    return await planning_dispatch(request, sources)
