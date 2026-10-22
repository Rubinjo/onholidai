import Link from "next/link";

import { Button } from "@/components/ui/button";

import { JourneyGlobe } from "./journey-globe";

export function MarketingHero() {
  return (
    <section className="marketing-hero" aria-labelledby="hero-heading">
      <div>
        <h1 id="hero-heading">One holiday. All the places you want to go.</h1>
        <p>
          Choose your destinations. Tell us when you can travel and what matters to you. Plan a
          multi-destination holiday with AI, then review every proposed change.
        </p>
        <Button size="lg" asChild>
          <Link href="/trips/new">Plan your holiday</Link>
        </Button>
        <p className="marketing-hero__note">
          Start planning without an account. Sign in only when you enter booking.
        </p>
      </div>
      <div className="marketing-journey-stage">
        <JourneyGlobe />
      </div>
    </section>
  );
}
