import { Progress } from "@/components/ui/progress";

import type { SetupStep } from "./draft-schema";

export const setupSteps: readonly SetupStep[] = [
  "destinations",
  "origin",
  "dates",
  "travellers",
  "preferences",
  "review",
];
export const setupStepLabels: Record<SetupStep, string> = {
  destinations: "Destinations",
  origin: "Departure",
  dates: "Dates",
  travellers: "Travellers",
  preferences: "Travel style",
  review: "Review",
};
export function SetupProgress({ step }: { step: SetupStep }) {
  const current = setupSteps.indexOf(step);
  return (
    <nav aria-label="Trip setup progress" className="setup-progress">
      <ol>
        {setupSteps.map((entry, index) => (
          <li key={entry} aria-current={entry === step ? "step" : undefined}>
            <span aria-hidden="true">{index + 1}</span> {setupStepLabels[entry]}
          </li>
        ))}
      </ol>
      <Progress
        value={((current + 1) / setupSteps.length) * 100}
        aria-label={`Step ${current + 1} of ${setupSteps.length}: ${setupStepLabels[step]}`}
      />
    </nav>
  );
}
