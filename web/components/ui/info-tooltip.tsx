"use client";

import { Tooltip } from "radix-ui";

import { Button } from "./button";

export function InfoTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button variant="ghost" size="icon" className="info-tooltip__trigger" aria-label={label}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v6" />
              <circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none" />
            </svg>
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="info-tooltip__content" sideOffset={6} collisionPadding={16}>
            {children}
            <Tooltip.Arrow className="info-tooltip__arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
