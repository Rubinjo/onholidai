import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";

afterEach(cleanup);

describe("shadcn UI primitives", () => {
  it("keeps Button focus visible with a minimum 44px target", () => {
    render(<Button>Continue</Button>);

    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain("focus-visible:outline-3");
    expect(button.className).toContain("min-h-11");
    expect(button.className).toContain("min-w-11");
  });

  it("keeps text controls focus visible and full width", () => {
    render(
      <>
        <Input aria-label="City" />
        <Textarea aria-label="Notes" />
      </>,
    );

    for (const name of ["City", "Notes"]) {
      const control = screen.getByRole("textbox", { name });
      expect(control.className).toContain("focus-visible:outline-3");
      expect(control.className).toContain("w-full");
      expect(control.className).toMatch(/\bmin-h-(?:11|24)\b/);
    }
    expect(screen.getByRole("textbox", { name: "City" }).className).toContain("min-h-11");
    expect(screen.getByRole("textbox", { name: "Notes" }).className).toContain("min-h-24");
  });

  it("announces alerts and applies the destructive variant", () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Save failed</AlertTitle>
        <AlertDescription>Retry when you are back online.</AlertDescription>
      </Alert>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Save failed");
    expect(alert).toHaveTextContent("Retry when you are back online.");
    expect(alert.className).toContain("border-destructive");
  });

  it("focuses dialog content and closes it on Escape", async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>Choose how to continue.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const dialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(dialog).toBeVisible();

    fireEvent.keyDown(document.activeElement ?? dialog, { code: "Escape", key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
