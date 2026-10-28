"""Wall-clock ceilings for one planning run.

Every progress event renews the durable run lease, so a run may legitimately take
minutes; these bounds only have to cap pathological work. They are stated once so a
purpose-specific graph cannot quietly cut off work that another graph already allows.
"""

# A live model completion is bounded by ``NEBIUS_REQUEST_TIMEOUT_SECONDS`` (90s by
# default) and supplier research can use most of a minute per source set, and an
# estimate may research a preferred and a flexible date set. Estimate and refinement
# resolve the same inputs, so they share one ceiling: a tighter refinement-only bound
# failed healthy requests in ~30 seconds while the identical estimate was still running.
PLANNING_GRAPH_BUDGET_SECONDS = 210
