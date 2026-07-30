import { devAuthAvailable } from "./actions";
import { LoginForm } from "./login-form";
import { DevSignIn } from "./dev-sign-in";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Evaluated on the server. In production this is false and the component
  // below is never rendered or sent to the client.
  const devAvailable = await devAuthAvailable();

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Walkup</h1>
      <p className="mt-1 text-sm text-stone-500">
        Sign in to your association&rsquo;s books.
      </p>

      <LoginForm />

      {devAvailable ? <DevSignIn /> : null}
    </div>
  );
}
