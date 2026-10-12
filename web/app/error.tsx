"use client";

import { StatusAnnouncer } from "@/components/ui/status-announcer";

type AppErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export default function AppError({ retry }: AppErrorProps) {
  const message = "This page could not be loaded. Try again.";

  return (
    <main className="app-shell">
      <StatusAnnouncer message={message} />
      <section className="app-shell__panel" aria-labelledby="error-heading">
        <h1 id="error-heading">Something went wrong</h1>
        <p>{message}</p>
        <button className="app-shell__action" onClick={retry} type="button">
          Try again
        </button>
      </section>
    </main>
  );
}