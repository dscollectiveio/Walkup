/**
 * The shortest password Walkup accepts. Length beats complexity rules:
 * twelve characters (a few random words) is far harder to guess than eight
 * with a symbol. Supabase's own minimum (Authentication → Sign In / Providers
 * → Email) should be set to match, and "Prevent use of leaked passwords"
 * turned on, so the rule also holds for anyone calling Supabase directly.
 */
export const MIN_PASSWORD = 12;
