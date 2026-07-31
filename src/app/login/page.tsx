import { devAuthAvailable } from "./actions";
import { LoginForm } from "./login-form";
import { DevSignIn } from "./dev-sign-in";
import { Lockup } from "@/components/mark";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Evaluated on the server. In production this is false and the component
  // below is never rendered or sent to the client.
  const devAvailable = await devAuthAvailable();

  return (
    <div className="mx-auto max-w-sm py-16">
      <Lockup />
      <p className="mt-4 text-mute">
        Sign in to your association&rsquo;s books.
      </p>

      <LoginForm />

      {devAvailable ? <DevSignIn /> : null}
    </div>
  );
}
