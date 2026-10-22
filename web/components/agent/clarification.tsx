"use client";
import { useRef, useState } from "react";

import { planningJson, planningError } from "@/components/trip-setup/http";
import { Button } from "@/components/ui/button";

export function Clarification({
  runId,
  question,
  onResume,
}: {
  runId: string;
  question: { id: string; question: string };
  onResume: () => void;
}) {
  const [answer, setAnswer] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    requestId = useRef(crypto.randomUUID());
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await planningJson(`/api/v1/agent-runs/${runId}/clarifications`, {
        requestId: requestId.current,
        questionId: question.id,
        answer,
      });
      onResume();
    } catch (failure) {
      setError(planningError(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="planning-card" disabled={busy}>
      <legend>Clarification needed</legend>
      <label>
        {question.question}
        <textarea
          value={answer}
          maxLength={4000}
          onChange={(event) => setAnswer(event.target.value)}
        />
      </label>
      <p role="alert">{error}</p>
      <Button disabled={!answer.trim()} onClick={() => void submit()}>
        Send clarification
      </Button>
    </fieldset>
  );
}
