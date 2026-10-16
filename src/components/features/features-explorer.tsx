"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  ChevronDown,
  FileText,
  FolderOpen,
  HandCoins,
  HardHat,
  Landmark,
  Lock,
  Search,
  ShieldCheck,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { Reveal, type Tone } from "@/components/landing/reveal";
import type { Audience, Category, CategoryIcon, Feature } from "@/lib/features/types";

const ICONS: Record<CategoryIcon, typeof Landmark> = {
  finance: Landmark,
  dues: HandCoins,
  tax: FileText,
  insurance: ShieldCheck,
  repairs: Wrench,
  contractors: HardHat,
  documents: FolderOpen,
  building: Building2,
  owners: Users,
  security: Lock,
  account: User,
};

const AUDIENCES: { key: "all" | Audience; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "board", label: "Board" },
  { key: "owners", label: "Owners" },
  { key: "accountant", label: "Accountant" },
];

const WHO_WORDS: Record<Audience, string> = { board: "Board", owners: "Owners", accountant: "Accountant" };
const EMAIL_WORDS = {
  approval: "Sends after a board admin approves",
  draft: "Drafted for you to send",
} as const;

// Bands rotate blue, taupe, white down the page, like the home page.
const TONES: Tone[] = ["blue", "taupe", "white"];

const matches = (f: Feature, q: string) =>
  !q || `${f.name} ${f.summary} ${f.details.join(" ")}`.toLowerCase().includes(q);

/**
 * The full features page: a category bar that follows you down and
 * highlights where you are, a search box, a "who is it for" filter, and
 * cards that open to show the specifics. Everything is plain HTML on first
 * load (cards start open with JavaScript off), so search engines and AI
 * tools can read every feature.
 */
export function FeaturesExplorer({ categories }: { categories: Category[] }) {
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<"all" | Audience>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(categories[0]?.id ?? "");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const barRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      categories
        .map((c) => ({
          ...c,
          features: c.features.filter((f) => (audience === "all" || f.who.includes(audience)) && matches(f, q)),
        }))
        .filter((c) => c.features.length > 0),
    [categories, audience, q],
  );
  const total = visible.reduce((n, c) => n + c.features.length, 0);
  const allCount = categories.reduce((n, c) => n + c.features.length, 0);
  const allOpen = total > 0 && visible.every((c) => c.features.every((f) => open.has(f.id)));

  // Which category is on screen, for the highlight in the bar.
  useEffect(() => {
    const els = visible.map((c) => sectionRefs.current[c.id]).filter((e): e is HTMLElement => Boolean(e));
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const onScreen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (onScreen[0]) setActive(onScreen[0].target.id.replace(/^cat-/, ""));
      },
      { rootMargin: "-140px 0px -60% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [visible]);

  // Keep the highlighted pill in view on narrow screens.
  useEffect(() => {
    const pill = barRef.current?.querySelector<HTMLElement>(`[data-cat="${active}"]`);
    if (pill && barRef.current) {
      const bar = barRef.current;
      bar.scrollTo({ left: pill.offsetLeft - bar.clientWidth / 2 + pill.clientWidth / 2, behavior: "smooth" });
    }
  }, [active]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setOpen(allOpen ? new Set() : new Set(visible.flatMap((c) => c.features.map((f) => f.id))));

  return (
    <div className="landing-smooth">
      {/* ------------------------------------------------------------ intro + controls */}
      <section className="land-taupe">
        <div className="mx-auto max-w-[1100px] px-6 pb-10 pt-14">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-eyebrow">Every feature</p>
          <h1 className="mt-2 max-w-3xl text-[36px] font-bold leading-[1.1] tracking-tight text-ink sm:text-[46px]">
            Everything Walkup does for your condo association.
          </h1>
          <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-mute">
            {allCount} features across {categories.length} areas, from the bank feed to the tax return. Search, filter by who uses
            it, and open any card for the specifics.
          </p>

          <div className="mt-7 flex flex-col gap-4 md:flex-row md:items-center">
            <label className="relative block min-w-0 flex-1 md:max-w-md">
              <span className="sr-only">Search features</span>
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search features, like “1099”, “quote” or “reminder”"
                className="h-11 w-full rounded-lg border border-line-strong bg-paper pl-10 pr-10 text-[14px] text-ink placeholder:text-mute-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-mute hover:bg-fill hover:text-ink"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null}
            </label>

            <div role="group" aria-label="Who is it for" className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-mute">For</span>
              {AUDIENCES.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  aria-pressed={audience === a.key}
                  onClick={() => setAudience(a.key)}
                  className={`min-h-[36px] rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-300 ${
                    audience === a.key
                      ? "border-[#1B2A41] bg-[#1B2A41] text-white"
                      : "border-line-strong bg-paper text-ink hover:bg-fill"
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-mute" aria-live="polite">
            <span>
              Showing <strong className="text-ink">{total}</strong> of {allCount} features
            </span>
            {total > 0 ? (
              <button type="button" onClick={toggleAll} className="font-medium text-ink underline underline-offset-4 hover:text-mute">
                {allOpen ? "Collapse all" : "Open every card"}
              </button>
            ) : null}
            {query || audience !== "all" ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setAudience("all");
                }}
                className="font-medium text-ink underline underline-offset-4 hover:text-mute"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ category bar */}
      <nav aria-label="Feature areas" className="sticky top-[73px] z-30 border-b border-line bg-paper/95 backdrop-blur">
        <div ref={barRef} className="mx-auto flex max-w-[1100px] gap-1.5 overflow-x-auto px-6 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visible.map((c) => {
            const Icon = ICONS[c.icon];
            const on = active === c.id;
            return (
              <a
                key={c.id}
                href={`#cat-${c.id}`}
                data-cat={c.id}
                aria-current={on ? "true" : undefined}
                className={`flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors duration-300 ${
                  on ? "bg-[#1B2A41] text-white" : "text-mute hover:bg-fill hover:text-ink"
                }`}
              >
                <Icon size={14} aria-hidden="true" />
                {c.title}
                <span className={`text-[11px] ${on ? "text-white/70" : "text-mute-soft"}`}>{c.features.length}</span>
              </a>
            );
          })}
        </div>
      </nav>

      {/* ------------------------------------------------------------ categories */}
      {total === 0 ? (
        <section className="land-white">
          <div className="mx-auto max-w-[1100px] px-6 py-20 text-center">
            <p className="text-[18px] font-semibold text-ink">No features match that.</p>
            <p className="mt-2 text-[14px] text-mute">Try a shorter word, or clear the filters to see everything.</p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setAudience("all");
              }}
              className="mt-5 inline-flex min-h-[44px] items-center rounded-md bg-ink px-5 text-[14px] font-semibold text-paper hover:bg-ink-mid"
            >
              Clear filters
            </button>
          </div>
        </section>
      ) : (
        visible.map((c, i) => {
          const Icon = ICONS[c.icon];
          return (
            <Reveal key={c.id} id={`cat-${c.id}`} tone={TONES[i % 3]} className="scroll-mt-14">
              <div ref={(el) => void (sectionRefs.current[c.id] = el?.parentElement ?? null)} className="mx-auto max-w-[1100px] px-6 py-14">
                <div className="flex items-start gap-4">
                  <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#D9A441]/15 text-eyebrow">
                    <Icon size={24} strokeWidth={1.7} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[26px] font-bold leading-tight tracking-tight text-ink sm:text-[30px]">{c.title}</h2>
                    <p className="mt-2 max-w-2xl text-[16px] leading-relaxed text-mute">{c.blurb}</p>
                  </div>
                </div>

                <ul className="mt-8 grid items-start gap-4 md:grid-cols-2">
                  {c.features.map((f) => {
                    const isOpen = open.has(f.id);
                    return (
                      <li key={f.id} className="rounded-xl border border-[#E3DED3] bg-white text-[#1B2A41] shadow-[0_6px_20px_-14px_rgba(27,42,65,0.35)]">
                        <button
                          type="button"
                          onClick={() => toggle(f.id)}
                          aria-expanded={isOpen}
                          aria-controls={`feature-${f.id}`}
                          className="flex w-full items-start justify-between gap-4 rounded-xl p-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass"
                        >
                          <span className="min-w-0">
                            <span className="block text-[16px] font-bold text-[#1B2A41]">{f.name}</span>
                            <span className="mt-1 block text-[14px] leading-relaxed text-[#5B6475]">{f.summary}</span>
                          </span>
                          <ChevronDown
                            size={18}
                            aria-hidden="true"
                            className={`mt-1 shrink-0 text-[#5B6475] transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                        <div
                          id={`feature-${f.id}`}
                          className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                        >
                          <div className="overflow-hidden">
                            <div className="border-t border-[#E3DED3] bg-white px-5 pb-5 pt-4">
                              <ul className="space-y-2 text-[14px] text-[#1B2A41]">
                                {f.details.map((d) => (
                                  <li key={d} className="flex gap-2.5">
                                    <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-[3px] h-4 w-4 shrink-0 text-[#1f6b45]">
                                      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    <span>{d}</span>
                                  </li>
                                ))}
                              </ul>
                              <div className="mt-4 flex flex-wrap gap-1.5">
                                {f.who.map((w) => (
                                  <span key={w} className="rounded-full border border-[#cdc6b6] px-2.5 py-0.5 text-[11px] font-medium text-[#5B6475]">
                                    {WHO_WORDS[w]}
                                  </span>
                                ))}
                                {f.email ? (
                                  <span className="rounded-full bg-[#f8efdb] px-2.5 py-0.5 text-[11px] font-semibold text-[#8a5f22]">
                                    {EMAIL_WORDS[f.email]}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Reveal>
          );
        })
      )}

      {/* ------------------------------------------------------------ closing call to action */}
      <section className="land-blue">
        <div className="mx-auto flex max-w-[1100px] flex-col items-start gap-6 px-6 py-16 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 className="text-[26px] font-bold tracking-tight text-ink sm:text-[30px]">See it with your own building.</h2>
            <p className="mt-2 text-[15px] text-mute">
              Set up in an afternoon. Read-only bank access, and nothing is sent without a board admin&rsquo;s approval.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/signup"
              data-cta="features-page"
              className="inline-flex min-h-[48px] items-center justify-center rounded-md bg-[#D9A441] px-6 text-[15px] font-bold text-[#1B2A41] transition-colors hover:bg-[#E4B75B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Create your building, free
            </Link>
            <Link
              href="/#pricing"
              className="inline-flex min-h-[48px] items-center justify-center rounded-md border border-line-strong px-6 text-[15px] font-semibold text-ink transition-colors hover:bg-fill"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
