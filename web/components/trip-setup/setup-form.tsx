"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { customerSnapshotSchema } from "@/domain/trip/proposal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusAnnouncer } from "@/components/ui/status-announcer";

import { Destinations } from "./destinations";
import { Availability } from "./availability";
import { PartyPreferences } from "./party-preferences";
import { Constraints } from "./constraints";
import { planningError } from "./http";
import { useSetupDraft } from "./use-setup-draft";
import { SetupProgress, setupSteps } from "./setup-progress";
import { SetupSummary } from "./setup-summary";
import { DraftComparison } from "./draft-comparison";

import type { SetupStep } from "./draft-schema";

const headings = {
  destinations: "Where would you like to go?",
  origin: "Where are you starting?",
  dates: "When can you travel?",
  travellers: "Who is coming along?",
  preferences: "What makes it your holiday?",
  review: "Review your holiday",
};
const fieldSteps: Record<string, SetupStep> = {
  destinations: "destinations",
  departureOrigin: "origin",
  availabilityWindows: "dates",
  duration: "dates",
  travellerParty: "travellers",
  preferences: "preferences",
  constraints: "preferences",
  title: "review",
  currency: "review",
};
class SetupFieldError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}
export function SetupForm() {
  const router = useRouter(),
    draft = useSetupDraft(),
    heading = useRef<HTMLHeadingElement>(null),
    errorRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const pendingFieldFocus = useRef<string | null>(null);
  const focusField = useCallback((field?: string) => {
    const target = field
      ? (formRef.current?.querySelector<HTMLElement>(`[data-setup-field="${CSS.escape(field)}"]`) ??
        formRef.current?.querySelector<HTMLElement>(
          `[data-setup-field="${CSS.escape(field.split(".")[0])}"]`,
        ))
      : null;
    if (target) {
      target.setAttribute("aria-invalid", "true");
      target.setAttribute("aria-describedby", "setup-validation-error");
      target.dataset.setupError = "true";
      target.focus();
    } else errorRef.current?.focus();
  }, []);
  const { payload: p, step } = draft,
    index = setupSteps.indexOf(step);
  const announcedStep = useRef<SetupStep | null>(null);
  useEffect(() => {
    const field = pendingFieldFocus.current;
    pendingFieldFocus.current = null;
    const previous = announcedStep.current;
    announcedStep.current = step;
    if (field) focusField(field);
    // Move focus to the step heading only when the step actually changes. Focusing on
    // initial load would override the document start and break skip-link behaviour.
    else if (previous !== null && previous !== step) heading.current?.focus();
  }, [step, focusField]);
  function validateStep() {
    if (step === "destinations" && !p.destinations.length)
      throw new SetupFieldError("destinations", "Add at least one destination.");
    if (step === "origin" && !p.departureOrigin?.confirmedByUser)
      throw new SetupFieldError("departureOrigin", "Confirm your departure city or airport.");
    if (step === "dates") {
      const invalidWindow = p.availabilityWindows.findIndex(
        (window) => !window.startDate || !window.endDate || window.endDate < window.startDate,
      );
      if (!p.availabilityWindows.length || invalidWindow >= 0)
        throw new SetupFieldError(
          `availabilityWindows.${Math.max(0, invalidWindow)}.endDate`,
          "Enter ordered start and end dates for every window.",
        );
      const d = p.duration;
      if (!d.minimumDays || !d.idealDays || !d.maximumDays)
        throw new SetupFieldError("duration.minimumDays", "Enter minimum, ideal and maximum days.");
      if (d.minimumDays > d.idealDays)
        throw new SetupFieldError(
          "duration.idealDays",
          "Ideal days must be at least minimum days.",
        );
      if (d.idealDays > d.maximumDays)
        throw new SetupFieldError(
          "duration.maximumDays",
          "Maximum days must be at least ideal days.",
        );
      if (
        !p.availabilityWindows.some(
          (window) =>
            (Date.parse(window.endDate) - Date.parse(window.startDate)) / 86400000 + 1 >=
            d.maximumDays!,
        )
      )
        throw new SetupFieldError(
          "duration.maximumDays",
          "Maximum days must fit an availability window.",
        );
    }
    if (step === "travellers") {
      if (p.travellerParty.adults === null)
        throw new SetupFieldError("travellerParty.adults", "Enter the adult count.");
      const missingAge = p.travellerParty.children.findIndex(
        (child) => child.ageAtTripStart === null,
      );
      if (missingAge >= 0)
        throw new SetupFieldError(
          `travellerParty.children.${missingAge}.ageAtTripStart`,
          "Enter each child's age at trip start.",
        );
      if (p.travellerParty.adults + p.travellerParty.children.length > 10)
        throw new SetupFieldError(
          "travellerParty.adults",
          "At most ten travellers: reduce adults or remove a child.",
        );
    }
    if (step === "preferences") {
      const missing = p.constraints.findIndex((constraint) => !constraint.statement.trim());
      if (missing >= 0)
        throw new SetupFieldError(
          `constraints.${missing}.statement`,
          "Enter requirement wording or remove its empty row.",
        );
    }
  }
  async function next(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      validateStep();
      if (step !== "review") {
        if (step === "origin" && !p.availabilityWindows.length)
          draft.update({
            ...p,
            availabilityWindows: [
              {
                id: crypto.randomUUID(),
                startDate: "",
                endDate: "",
                timezone: p.departureOrigin!.timezone,
                preference: "preferred",
              },
            ],
          });
        draft.go(setupSteps[index + 1]);
        return;
      }
      const { title, currency, ...facts } = p;
      if (!title.trim())
        throw new SetupFieldError(
          "title",
          "Give your holiday a title before requesting an estimate.",
        );
      customerSnapshotSchema.parse({
        ...facts,
        itineraryDays: [],
        components: [],
        warnings: [],
        price: {
          currency,
          finalCustomerMinor: 0,
          taxesMinor: 0,
          feesMinor: 0,
          status: "estimated",
          checkedAt: new Date().toISOString(),
        },
      });
      const submitted = z
        .object({
          tripId: z.uuid(),
          version: z.number().int().positive(),
          researchRequestId: z.uuid(),
        })
        .passthrough()
        .parse(await draft.submit());
      // The submitted draft durably records the authorized research request.
      // Navigate immediately; the workspace starts or recovers that same request.
      router.push(`/trips/${submitted.tripId}`);
    } catch (failure) {
      setError(
        failure instanceof z.ZodError
          ? `Check ${failure.issues[0]?.path.join(" / ")}: ${failure.issues[0]?.message}`
          : failure instanceof SetupFieldError
            ? failure.message
            : planningError(failure),
      );
      const field =
        failure instanceof SetupFieldError
          ? failure.field
          : failure instanceof z.ZodError
            ? failure.issues[0]?.path.join(".")
            : undefined;
      const targetStep = field ? fieldSteps[field.split(".")[0]] : undefined;
      if (field && targetStep && targetStep !== step) {
        pendingFieldFocus.current = field;
        draft.go(targetStep);
      } else requestAnimationFrame(() => focusField(field));
    } finally {
      setBusy(false);
    }
  }
  const origin = p.departureOrigin?.confirmedByUser
    ? { ...p.departureOrigin, confirmedByUser: true as const }
    : null;
  return (
    <>
      <SetupProgress step={step} />
      <div className="setup-layout">
        <form
          ref={formRef}
          onSubmit={(event) => void next(event)}
          aria-busy={busy}
          className="setup-form"
          onInvalid={(event) => {
            if (event.target instanceof HTMLElement) {
              const section = event.target.closest("details");
              if (section) section.open = true;
              event.target.setAttribute("aria-invalid", "true");
              event.target.setAttribute("aria-describedby", "setup-validation-error");
              event.target.dataset.setupError = "true";
            }
            setError("Check the highlighted field before continuing.");
          }}
          onInput={(event) => {
            if (event.target instanceof HTMLElement && event.target.dataset.setupError) {
              event.target.removeAttribute("aria-invalid");
              event.target.removeAttribute("aria-describedby");
              delete event.target.dataset.setupError;
            }
          }}
        >
          <h1 ref={heading} tabIndex={-1}>
            {headings[step]}
          </h1>
          <p id="setup-validation-error" ref={errorRef} tabIndex={-1} role="alert">
            {error || draft.error}
          </p>
          {!draft.ready && (
            <Button variant="outline" onClick={() => void draft.initialize()}>
              Retry opening draft
            </Button>
          )}
          {draft.submittedTripId ? (
            <p>
              This setup has been submitted.{" "}
              <a href={`/trips/${draft.submittedTripId}`}>Continue your saved trip</a>
            </p>
          ) : (
            <fieldset key={step} disabled={busy} className="setup-fields">
              <legend className="sr-only">{headings[step]}</legend>
              {(step === "destinations" || step === "origin") && (
                <Destinations
                  mode={step}
                  globe={step === "destinations"}
                  origin={origin}
                  destinations={p.destinations}
                  onOrigin={(departureOrigin) => draft.update({ ...p, departureOrigin })}
                  origins={p.departureOrigins ?? (origin ? [origin] : [])}
                  order={p.destinationOrder ?? "manual"}
                  onOrder={(destinationOrder) => draft.update({ ...p, destinationOrder })}
                  onOrigins={(departureOrigins) =>
                    draft.update({
                      ...p,
                      departureOrigins,
                      departureOrigin:
                        departureOrigins.find((entry) => entry.placeId === origin?.placeId) ??
                        departureOrigins[0] ??
                        null,
                    })
                  }
                  onDestinations={(destinations) => draft.update({ ...p, destinations })}
                />
              )}
              {step === "dates" && (
                <Availability
                  windows={p.availabilityWindows}
                  timezone={p.departureOrigin?.timezone}
                  duration={{
                    minimumDays: p.duration.minimumDays ?? 0,
                    idealDays: p.duration.idealDays ?? 0,
                    maximumDays: p.duration.maximumDays ?? 0,
                  }}
                  onChange={({ windows: availabilityWindows, duration }) =>
                    draft.update({
                      ...p,
                      availabilityWindows,
                      duration: {
                        minimumDays: duration.minimumDays || null,
                        idealDays: duration.idealDays || null,
                        maximumDays: duration.maximumDays || null,
                      },
                    })
                  }
                />
              )}
              {(step === "travellers" || step === "preferences") && (
                <div className={step === "travellers" ? "setup-party-only" : "setup-style-only"}>
                  <PartyPreferences
                    party={{
                      adults: p.travellerParty.adults ?? 0,
                      children: p.travellerParty.children.map((child) => ({
                        ...child,
                        ageAtTripStart: child.ageAtTripStart ?? -1,
                      })),
                    }}
                    preferences={p.preferences}
                    onParty={(party) =>
                      draft.update({
                        ...p,
                        travellerParty: {
                          adults: party.adults || null,
                          children: party.children.map((child) => ({
                            ...child,
                            ageAtTripStart: child.ageAtTripStart < 0 ? null : child.ageAtTripStart,
                          })),
                        },
                      })
                    }
                    onPreferences={(preferences) => draft.update({ ...p, preferences })}
                    mode={step === "travellers" ? "party" : "preferences"}
                  />
                </div>
              )}
              {step === "preferences" && (
                <Constraints
                  constraints={p.constraints}
                  onChange={(constraints) => draft.update({ ...p, constraints })}
                />
              )}
              {step === "review" && (
                <>
                  <label htmlFor="setup-title">Trip title</label>
                  <Input
                    data-setup-field="title"
                    id="setup-title"
                    value={p.title}
                    maxLength={120}
                    required
                    onChange={(event) => draft.update({ ...p, title: event.target.value })}
                  />
                  <label htmlFor="setup-currency">Presentation currency</label>
                  <select
                    id="setup-currency"
                    value={p.currency}
                    onChange={(event) => draft.update({ ...p, currency: event.target.value })}
                  >
                    <option>EUR</option>
                    <option>GBP</option>
                    <option>USD</option>
                    <option>JPY</option>
                  </select>
                  <h2>Your reviewed settings</h2>
                  <p>
                    {p.availabilityWindows
                      .map(
                        (window) =>
                          `${window.preference}: ${window.startDate} to ${window.endDate}`,
                      )
                      .join("; ")}
                  </p>
                  <p>
                    Duration: {p.duration.minimumDays} minimum, {p.duration.idealDays} ideal,{" "}
                    {p.duration.maximumDays} maximum days.
                  </p>
                  <p>
                    Child ages:{" "}
                    {p.travellerParty.children
                      .map((child) => child.ageAtTripStart ?? "Missing")
                      .join(", ") || "No children"}
                    .
                  </p>
                  <ul>
                    {p.constraints.map((constraint) => (
                      <li key={constraint.id}>
                        {constraint.priority}: {constraint.statement} ({constraint.status})
                      </li>
                    ))}
                  </ul>
                  <p>
                    Research produces an estimated proposal. You will review and explicitly accept
                    it. Nothing is reserved or paid for.
                  </p>
                </>
              )}
              <div className="setup-actions">
                <Button
                  variant="outline"
                  disabled={index === 0}
                  onClick={() => {
                    setError("");
                    draft.go(setupSteps[index - 1]);
                  }}
                >
                  Back
                </Button>
                <Button type="submit" disabled={step === "review" && !draft.ready}>
                  {step === "review" ? "Create trip and research estimate" : "Continue"}
                </Button>
              </div>
            </fieldset>
          )}
          <p role="status">{busy ? "Working…" : draft.status}</p>
          <StatusAnnouncer message={`Step ${index + 1} of 6. ${draft.status}`} />
          {draft.error && draft.ready && (
            <div className="setup-actions">
              <Button variant="outline" onClick={() => void draft.flush().catch(() => undefined)}>
                Retry saving
              </Button>
              <Button variant="outline" onClick={() => void draft.compare()}>
                Compare saved draft
              </Button>
            </div>
          )}
          {draft.comparison && (
            <section aria-label="Draft conflict comparison">
              <h2>Compare before continuing</h2>
              <p>
                Saved title: {draft.comparison.payload.title || "Untitled"}. Saved route:{" "}
                {draft.comparison.payload.destinations.map((entry) => entry.name).join(", ")}.
              </p>
              <DraftComparison saved={draft.comparison.payload} local={p} />
              <p>
                Your local entries are still visible above. Choosing an option below is explicit; no
                merge happens automatically.
              </p>
              <Button variant="outline" onClick={() => draft.resolve(true)}>
                Use saved draft
              </Button>
              <Button
                disabled={Boolean(draft.comparison.submittedTripId)}
                onClick={() => draft.resolve(false)}
              >
                Replace saved draft with my local changes
              </Button>
            </section>
          )}
        </form>
        <SetupSummary payload={p} />
      </div>
      <p className="setup-privacy">
        Your guest plan stays private in this browser for 30 days of inactivity. Clearing browser
        cookies removes guest access. Signing in is required only when you enter booking.
      </p>
    </>
  );
}
