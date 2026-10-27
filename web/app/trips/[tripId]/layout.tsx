import { MarketingNavigation } from "@/components/marketing/navigation";

import type { ReactNode } from "react";

export default async function TripLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return (
    <div className="trip-page-shell">
      <MarketingNavigation returnPath={`/trips/${encodeURIComponent(tripId)}`} />
      {children}
    </div>
  );
}
