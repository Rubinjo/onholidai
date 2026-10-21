import Image from "next/image";
import Link from "next/link";

export function BrandLink() {
  return <Link href="/" className="brand-link" aria-label="OnHolidai home">
    <Image src="/logo/main_logo.svg" alt="OnHolidai" width={460} height={104} unoptimized />
  </Link>;
}
