import Link from "next/link";
import { MarketingNavigation } from "@/components/marketing/navigation";
import { MarketingHero } from "@/components/marketing/hero";
import { PlanningProcess } from "@/components/marketing/process";
import { ItineraryExample } from "@/components/marketing/itinerary-example";
import { Button } from "@/components/ui/button";
export default function HomePage() {
  return <div className="marketing-page"><MarketingNavigation /><main><MarketingHero /><PlanningProcess />
    <section className="marketing-benefits" aria-labelledby="benefits-heading"><h2 id="benefits-heading">Room for what matters to your travellers.</h2>
      <div><p>Keep family ages, flexible dates, accessibility needs and other requirements visible in the plan. Review uncertain facts before relying on them.</p>
        <p>Your private guest plan can be recovered in this browser while its session is active. An account keeps a selected trip associated with you when you enter booking.</p>
        <p>Research, authentication and accepted planning changes do not make reservations or payments. Booking keeps its own live checks and exact-term confirmation.</p></div></section>
    <section className="marketing-examples" aria-label="Illustrative holidays"><ItineraryExample title="Three cities, your own pace" places={["Lisbon", "Coimbra", "Porto"]}
      description="Make room for a slow lunch between city days. Adjust the route rather than starting your plan again." />
      <ItineraryExample title="Across two neighboring countries" places={["Tokyo", "Kyoto", "Seoul"]}
        description="Begin with a country, then choose its cities. Let AI suggest a connected journey across Japan and South Korea." /></section>
    <section className="marketing-start"><h2>Where is your next holiday taking you?</h2><Button size="lg" asChild><Link href="/trips/new">Plan your holiday</Link></Button>
      <p>No account needed to explore a plan. Examples are illustrative; prices, inventory and supplier availability require current checks.</p></section>
  </main><footer className="marketing-footer">OnHolidai · A plan you can review, refine and choose.</footer></div>;
}
