import type { ComponentPropsWithoutRef } from "react";

type StatusAnnouncerProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "aria-atomic" | "aria-live" | "children" | "role"
> & {
  message?: string | null;
};

export function StatusAnnouncer({ className, message, ...containerProps }: StatusAnnouncerProps) {
  const classes = ["sr-only", className].filter(Boolean).join(" ");

  return (
    <div
      {...containerProps}
      aria-atomic="true"
      aria-live="polite"
      className={classes}
      role="status"
    >
      {message?.trim() ?? ""}
    </div>
  );
}
