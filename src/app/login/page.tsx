import Link from "next/link";
import { devAuthAvailable } from "./actions";
import { LoginForm } from "./login-form";
import { DevSignIn } from "./dev-sign-in";
import { Lockup } from "@/components/mark";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Evaluated on the server. In production this is false and the component
  // below is never rendered or sent to the client.
  const devAvailable = await devAuthAvailable();
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-sm py-16">
      <Lockup />
      <p className="mt-4 text-mute">
        Sign in to your association&rsquo;s books.
      </p>

      {error === "confirmation_failed" ? (
        <p className="mt-4 border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
          That confirmation link didn&rsquo;t work — it may have expired. Try
          signing up again.
        </p>
      ) : null}

      <LoginForm />

      <p className="mt-4 text-[13px] text-mute">
        New here?{" "}
        <Link href="/signup" className="text-ink underline-offset-2 hover:underline">
          Create an account
        </Link>
      </p>

      {devAvailable ? <DevSignIn /> : null}
    </div>
  );
}
