import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardOnlyView } from "@/components/board-only-view";
import { ContactLine } from "@/components/owner/contact-line";

const html = (props: Parameters<typeof BoardOnlyView>[0]) => renderToStaticMarkup(createElement(BoardOnlyView, props));
const text = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("BoardOnly (owner-portal-spec 2.4)", () => {
  const base = { what: "The bank feed", why: "It shows the association's bank transactions, which only the board and the accountant can see." };

  it("says so plainly, names the page and what it is", () => {
    const t = text(html({ ...base, contact: null }));
    expect(t).toContain("This part is for the board");
    expect(t).toContain("The bank feed is open to board members and the accountant. It shows the association's bank transactions, which only the board and the accountant can see.");
  });

  it("points to the owner page that serves the same need", () => {
    const h = html({ ...base, alternative: { label: "See your statement", href: "/owner" }, contact: null });
    expect(h).toContain('href="/owner"');
    expect(text(h)).toContain("See your statement");
  });

  it("has no button when there is no alternative", () => {
    expect(html({ ...base, contact: null })).not.toContain("<a ");
  });

  it("writes to the board contact when an email is set", () => {
    const h = html({ ...base, contact: { name: "Maria, treasurer", email: "board@example.com", phone: null } });
    expect(h).toContain('href="mailto:board@example.com"');
    expect(text(h)).toContain("Questions? Write to Maria, treasurer.");
  });

  it('falls back to "the board" for the name, and to asking a board member without an email', () => {
    expect(text(html({ ...base, contact: { name: null, email: "board@example.com", phone: null } }))).toContain("Write to the board.");
    expect(text(html({ ...base, contact: { name: "Maria", email: null, phone: null } }))).toContain("Questions? Ask a board member.");
    expect(text(html({ ...base, contact: null }))).toContain("Questions? Ask a board member.");
  });

  it("uses no em dash", () => {
    expect(html({ ...base, alternative: { label: "x", href: "/owner" }, contact: { name: "a", email: "b@c.de", phone: null } })).not.toContain("—");
  });
});

describe("ContactLine (owner-portal-spec 6.6)", () => {
  const render = (props: Parameters<typeof ContactLine>[0]) => renderToStaticMarkup(createElement(ContactLine, props));
  it("name, mailto and tel", () => {
    const h = render({ contact: { name: "The board", email: "board@example.com", phone: "(312) 555-0100" } });
    expect(h).toContain('href="mailto:board@example.com"');
    expect(h).toContain('href="tel:3125550100"');
    expect(text(h)).toContain("Write to the board");
  });
  it('says "Ask a board member." when nothing is set, and offers admins a link', () => {
    expect(text(render({ contact: null }))).toBe("Ask a board member.");
    const admin = render({ contact: { name: null, email: null, phone: null }, canEdit: true });
    expect(admin).toContain('href="/building#contact"');
    expect(text(render({ contact: null, canEdit: false }))).not.toContain("Add the board contact");
  });
});
