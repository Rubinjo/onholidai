import Link from "next/link";
import Image from "next/image";
import { BrandLink } from "@/components/brand-link";
import { MarketingNavigation } from "@/components/marketing/navigation";
import { MarketingHero } from "@/components/marketing/hero";
import { PlanningProcess } from "@/components/marketing/process";
import { JourneyRange } from "@/components/marketing/journey-range";
import { Button } from "@/components/ui/button";
export default function HomePage() {
  return <div className="marketing-page"><MarketingNavigation /><main><MarketingHero /><PlanningProcess />
    <JourneyRange />
    <section className="marketing-project" aria-labelledby="project-heading">
      <div className="marketing-project__story"><h2 id="project-heading">A small project.<br />A world of possibilities.</h2>
        <p>OnHolidai is a project for the <a href="https://nebiusglobalaihackathon.devpost.com/">Nebius x NVIDIA Global AI Hackathon</a>, exploring how AI can make a holiday with more than one destination feel simpler to plan.</p>
      </div>
      <div className="marketing-project__logos" aria-label="Hackathon organizers">
        <Image src="/logo/Nebius_logo.svg" alt="Nebius" width={1547} height={427} />
        <span aria-hidden="true">×</span>
        <Image src="/logo/NVIDIA_logo.svg" alt="NVIDIA" width={656} height={120} />
      </div>
      <aside className="marketing-sandbox" aria-labelledby="sandbox-heading">
        <span className="marketing-sandbox__badge">Sandbox / demo mode</span>
        <div><h3 id="sandbox-heading">Real possibilities. No real bookings.</h3>
          <p>This website is currently a sandbox demo. Explore the planning experience, but no real bookings are made, no tickets are issued and no payments are taken.</p></div>
      </aside>
    </section>
    <section className="marketing-start" aria-labelledby="start-heading"><div><h2 id="start-heading">See where your ideas take you.</h2>
      <p>Try a city, a country, or that trip you keep talking about.</p></div>
      <div className="marketing-start__action"><Button size="lg" asChild><Link href="/trips/new">Plan your holiday</Link></Button>
        <span>No account needed to start exploring.</span></div></section>
  </main><footer className="marketing-footer"><BrandLink /><p>Made for the journey, not just the destination.</p><a href="https://nebiusglobalaihackathon.devpost.com/">About the hackathon</a></footer></div>;
}
