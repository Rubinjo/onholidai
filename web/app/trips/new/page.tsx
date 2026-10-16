import { SetupForm } from "@/components/trip-setup/setup-form";
import Link from "next/link";
export default function NewTripPage() {
  return <main className="planning-page setup-page"><Link href="/">OnHolidai</Link><SetupForm /></main>;
}
