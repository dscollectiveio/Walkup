import Link from "next/link";
import { devAuthAvailable } from "./actions";
import { LoginForm } from "./login-form";
import { DevSignIn } from "./dev-sign-in";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata = { title: "Sign in | Walkup" };

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  // Evaluated on the server. In production this is false and the component
  // below is never rendered or sent to the client.
  const devAvailable = await devAuthAvailable();
  const { error, notice } = await searchParams;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your association's books."
      aside={{
        heading: "Good to see you again.",
        body: "Your building's books, dues, budget and tax deadlines, right where you left them.",
      }}
      footer={
        <>
          New to Walkup?{" "}
          <Link href="/signup" className="inline-flex min-h-[44px] items-center font-semibold text-ink underline-offset-2 hover:underline">
            Create an account, free
          </Link>
        </>
      }
    >
      {error === "confirmation_failed" ? (
        <p className="mb-5 rounded-lg border border-bad-line bg-bad-tint px-3.5 py-2.5 text-[13px] text-bad-text">
          That confirmation link didn&rsquo;t work. It may have expired. Try signing up again.
        </p>
      ) : null}

      {notice === "confirmed_elsewhere" ? (
        <p className="mb-5 rounded-lg border border-good-line bg-good-tint px-3.5 py-2.5 text-[13px] text-good-text">
          Your email is confirmed. Sign in to keep going.
        </p>
      ) : notice === "reset_other_browser" ? (
        <p className="mb-5 rounded-lg border border-warning-line bg-warning-tint px-3.5 py-2.5 text-[13px] text-warning-text">
          That reset link was opened in a different browser. Ask for a new one from this browser, or sign in here if you
          remember your password.
        </p>
      ) : null}

      <LoginForm />

      {devAvailable ? <DevSignIn /> : null}
    </AuthShell>
  );
}
