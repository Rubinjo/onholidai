import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("relative w-full min-w-0 rounded-lg border p-4 text-sm", {
  variants: { variant: {
    default: "border-border bg-card text-card-foreground",
    destructive: "border-destructive bg-card text-destructive",
  } }, defaultVariants: { variant: "default" },
});
export function Alert({ className, variant, role = "alert", ...props }: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role={role} className={cn(alertVariants({ variant }), className)} {...props} />;
}
export function AlertTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 data-slot="alert-title" className={cn("mb-1 font-semibold leading-normal", className)} {...props} />;
}
export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("grid gap-2 leading-relaxed break-words", className)} {...props} />;
}
