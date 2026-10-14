"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { emptySetupDraft, type SetupDraftPayload, type SetupStep } from "./draft-schema";
import { setupDraftEnvelopeSchema } from "@/server/db/planning-schema";
import { planningError, planningJson, PlanningRequestError } from "./http";
type Envelope = ReturnType<typeof setupDraftEnvelopeSchema.parse>;
type Save = { requestId: string; expectedRevision: number; currentStep: SetupStep; payload: SetupDraftPayload };

export function useSetupDraft() {
  const [payload, setPayload] = useState(emptySetupDraft), [step, setStep] = useState<SetupStep>("destinations");
  const [status, setStatus] = useState("Opening your private draft…"), [error, setError] = useState("");
  const [ready, setReady] = useState(false), [comparison, setComparison] = useState<Envelope | null>(null);
  const [submittedTripId, setSubmittedTripId] = useState<string | null>(null);
  const server = useRef<Envelope | null>(null), latest = useRef({ payload, step }), pending = useRef<Save | null>(null);
  const allocationId = useRef<string | null>(null), chain = useRef<Promise<void>>(Promise.resolve()), blocked = useRef(false);
  const revisionOfInput = useRef(0), committedInput = useRef(0), mounted = useRef(false);
  const initializing = useRef(false);
  useEffect(() => { latest.current = { payload, step }; }, [payload, step]);
  const initialize = useCallback(async () => {
    if (initializing.current) return;
    initializing.current = true;
    setError(""); setStatus("Opening your private draft…");
    try {
      allocationId.current ??= crypto.randomUUID();
      await planningJson("/api/v1/planning-session", { requestId: allocationId.current });
      const target = new URL(window.location.href).searchParams.get("draftId");
      const draft = setupDraftEnvelopeSchema.parse(await (target ? planningJson(`/api/v1/setup-drafts/${encodeURIComponent(target)}`)
        : planningJson("/api/v1/setup-drafts", { requestId: allocationId.current })));
      if (!mounted.current) return;
      server.current = draft; setSubmittedTripId(draft.submittedTripId);
      const editedDuringInitialization = revisionOfInput.current !== committedInput.current;
      if (!editedDuringInitialization) {
        latest.current = { payload: draft.payload, step: draft.currentStep };
        setPayload(draft.payload); setStep(draft.currentStep); setStatus("Saved");
      } else if (target) {
        blocked.current = true; setComparison(draft); setError("Saved entries loaded while you were editing. Compare before choosing which entries to keep.");
        setStatus("Local edits preserved; compare saved draft");
      } else setStatus("Unsaved changes");
      setReady(true);
      const url = new URL(window.location.href); url.searchParams.set("draftId", draft.draftId); window.history.replaceState(null, "", url);
    } catch (failure) { if (mounted.current) { setError(planningError(failure)); setStatus("Draft not opened"); } }
    finally { initializing.current = false; }
  }, []);
  useEffect(() => { mounted.current = true; void initialize(); return () => { mounted.current = false; }; }, [initialize]);
  const flush = useCallback((): Promise<void> => {
    const task = async () => {
      if (!server.current) throw new PlanningRequestError(401, "guest_session_unavailable");
      if (blocked.current) throw new PlanningRequestError(409, "draft_revision_conflict");
      while (pending.current || committedInput.current !== revisionOfInput.current) {
        const inputRevision = revisionOfInput.current;
        pending.current ??= { requestId: crypto.randomUUID(), expectedRevision: server.current.revision,
          currentStep: latest.current.step, payload: structuredClone(latest.current.payload) };
        const attempt = pending.current;
        setStatus("Saving…");
        try {
          const saved = setupDraftEnvelopeSchema.parse(await planningJson(`/api/v1/setup-drafts/${server.current.draftId}`, attempt, "PATCH"));
          server.current = saved; pending.current = null;
          // An uncertain response may have acknowledged an older snapshot. Only
          // mark the current input committed when it exactly matches that save.
          if (JSON.stringify(saved.payload) === JSON.stringify(latest.current.payload) && saved.currentStep === latest.current.step) {
            committedInput.current = revisionOfInput.current;
          } else if (inputRevision === revisionOfInput.current) committedInput.current = -1;
          setError(""); setStatus(committedInput.current === revisionOfInput.current ? "Saved" : "Unsaved changes");
        } catch (failure) {
          if (failure instanceof PlanningRequestError && failure.status === 422) pending.current = null;
          if (failure instanceof PlanningRequestError && failure.code === "draft_revision_conflict") blocked.current = true;
          setError(planningError(failure)); setStatus(blocked.current ? "Conflict: local edits preserved" : "Unsaved changes; retry saving");
          throw failure;
        }
      }
    };
    const next = chain.current.catch(() => undefined).then(task); chain.current = next; return next;
  }, []);
  useEffect(() => {
    if (!ready || committedInput.current === revisionOfInput.current || blocked.current) return;
    const timer = setTimeout(() => { void flush().catch(() => undefined); }, 500);
    return () => clearTimeout(timer);
  }, [payload, step, ready, flush]);
  function update(next: SetupDraftPayload) { latest.current = { ...latest.current, payload: next }; revisionOfInput.current++; setPayload(next); setStatus("Unsaved changes"); }
  function go(next: SetupStep) { latest.current = { ...latest.current, step: next }; revisionOfInput.current++; setStep(next); setStatus("Unsaved changes"); }
  async function compare() {
    if (!server.current) return;
    try { setComparison(setupDraftEnvelopeSchema.parse(await planningJson(`/api/v1/setup-drafts/${server.current.draftId}`))); }
    catch (failure) { setError(planningError(failure)); }
  }
  function resolve(useSaved: boolean) {
    if (!comparison) return;
    server.current = comparison; pending.current = null; blocked.current = false;
    setSubmittedTripId(comparison.submittedTripId);
    if (useSaved) { latest.current = { payload: comparison.payload, step: comparison.currentStep }; setPayload(comparison.payload); setStep(comparison.currentStep); committedInput.current = revisionOfInput.current; }
    else revisionOfInput.current++;
    setComparison(null); setError(""); setStatus(useSaved ? "Saved" : "Unsaved changes");
    if (!useSaved) void flush().catch(() => undefined);
  }
  async function submit() {
    await flush();
    if (!server.current) throw new Error("Draft unavailable");
    const response = await planningJson(`/api/v1/setup-drafts/${server.current.draftId}/submit`, { expectedRevision: server.current.revision });
    if (typeof response === "object" && response && "tripId" in response && typeof response.tripId === "string") setSubmittedTripId(response.tripId);
    return response;
  }
  return { payload, step, update, go, ready, status, error, flush, submit, initialize, compare, comparison, resolve,
    submittedTripId };
}
