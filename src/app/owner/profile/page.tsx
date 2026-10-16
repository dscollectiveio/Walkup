import { redirect } from "next/navigation";

/** The owner profile moved into Your account, which every role now shares. */
export default function OwnerProfilePage() {
  redirect("/account");
}
