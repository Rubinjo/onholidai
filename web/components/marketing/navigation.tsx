import Link from "next/link";
import { Button } from "@/components/ui/button";
export function MarketingNavigation() {
  return <header className="marketing-nav"><Link href="/" className="marketing-brand" aria-label="OnHolidai home">OnHolidai<span aria-hidden="true">✳</span></Link>
    <nav aria-label="Main navigation"><Link href="/trips/new">Start planning</Link><Link href="/sign-in">Sign in</Link>
      <Button variant="outline" asChild><Link href="/sign-up">Free sign-up</Link></Button></nav></header>;
}
