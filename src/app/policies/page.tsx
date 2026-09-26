import Link from "next/link";
import { Lockup } from "@/components/mark";

export const metadata = { title: "Policies — Walkup" };

const POLICIES = [
  { href: "/security", title: "Security & Privacy", desc: "How access, authentication, and data protection work." },
  { href: "/privacy", title: "Privacy Policy", desc: "What we collect, why, and your rights over it." },
  { href: "/policies/access-controls", title: "Access Controls Policy", desc: "Who can access what, how identity is verified, and how access is reviewed and removed." },
  { href: "/policies/vulnerability-management", title: "Vulnerability and Patch Management Policy", desc: "How known vulnerabilities and end-of-life software are found and fixed." },
  { href: "/policies/data-retention", title: "Data Retention and Deletion Policy", desc: "What's kept, for how long, and how to have your data removed." },
];

export default function PoliciesIndexPage() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <Link href="/">
        <Lockup />
      </Link>

      <h1 className="mt-8 text-[22px] font-semibold tracking-tight text-ink">Policies</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-mute">
        Every policy governing how Walkup handles access and data, kept current with what the
        application actually does.
      </p>

      <ul className="mt-8 divide-y divide-line border-y border-line">
        {POLICIES.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="block py-4 hover:bg-fill">
              <span className="text-[14px] font-medium text-ink">{p.title}</span>
              <span className="mt-1 block text-[13px] text-mute">{p.desc}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-[13px]">
        <Link href="/" className="text-ink underline-offset-2 hover:underline">
          &larr; Back to Walkup
        </Link>
      </p>
    </div>
  );
}
