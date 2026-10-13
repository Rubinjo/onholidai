import Link from "next/link";
export default function HomePage() {
  return <main className="planning-page"><h1>Onholidai</h1><p>Plan a holiday and explicitly review an estimated draft.</p><Link href="/trips/new">Plan your holiday</Link><p>Booking is not available yet.</p></main>;
}
