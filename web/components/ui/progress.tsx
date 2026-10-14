"use client";

import type { ComponentProps } from "react";
import { Progress as ProgressPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function Progress({ className, value, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  const bounded = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  return <ProgressPrimitive.Root {...props} data-slot="progress" max={100} value={bounded}
    className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)}>
    <ProgressPrimitive.Indicator data-slot="progress-indicator" className="h-full bg-primary"
      style={{ width: bounded === null ? "100%" : `${bounded}%` }} />
  </ProgressPrimitive.Root>;
}
