"use client";

import type { ComponentProps } from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { DialogOverlay } from "./dialog";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

export function SheetContent({ className, children, side = "right", ...props }:
  ComponentProps<typeof SheetPrimitive.Content> & { side?: "left" | "right" | "top" | "bottom" }) {
  const position = { left: "inset-y-0 left-0 w-[min(28rem,100%)]", right: "inset-y-0 right-0 w-[min(28rem,100%)]",
    top: "inset-x-0 top-0 max-h-[90dvh]", bottom: "inset-x-0 bottom-0 max-h-[90dvh]" };
  return <SheetPrimitive.Portal><DialogOverlay />
    <SheetPrimitive.Content data-slot="sheet-content" className={cn(
      "fixed z-50 flex min-w-0 flex-col gap-4 overflow-y-auto border border-border bg-background p-6 text-foreground shadow-xl",
      position[side], className)} {...props}>
      {children}
      <SheetPrimitive.Close className="min-h-11 self-end rounded-md border border-input px-4 py-2">Close</SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>;
}
export function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("grid gap-2 text-left", className)} {...props} />;
}
export function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="sheet-footer" className={cn("mt-auto flex flex-wrap gap-3", className)} {...props} />;
}
export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("text-xl font-semibold", className)} {...props} />;
}
export function SheetDescription({ className, ...props }: ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
