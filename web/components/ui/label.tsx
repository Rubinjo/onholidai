"use client";

import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

import type { ComponentProps } from "react";

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("text-sm leading-normal font-semibold", className)}
      {...props}
    />
  );
}
