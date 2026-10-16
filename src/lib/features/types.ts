export type Audience = "board" | "owners" | "accountant";

/** How a feature involves email, shown as a small badge so nothing is oversold. */
export type EmailMode = "approval" | "draft";

export interface Feature {
  id: string;
  name: string;
  /** One plain sentence: what it does for the person using it. */
  summary: string;
  /** Specific, verifiable capabilities, shown when the card is opened. */
  details: string[];
  who: Audience[];
  email?: EmailMode;
}

export type CategoryIcon =
  | "finance"
  | "dues"
  | "tax"
  | "insurance"
  | "repairs"
  | "contractors"
  | "documents"
  | "building"
  | "owners"
  | "security"
  | "account";

export interface Category {
  id: string;
  title: string;
  icon: CategoryIcon;
  /** Two sentences for the top of the section. */
  blurb: string;
  features: Feature[];
}
