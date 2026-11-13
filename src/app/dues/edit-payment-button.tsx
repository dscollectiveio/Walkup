"use client";

import { HEADER_BUTTON } from "@/components/ui";
import { EDIT_PAYMENT_EVENT } from "./edit-payment-event";

/** In the "How owners pay" card header. Opens the form below. */
export function EditPaymentDetailsButton() {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new Event(EDIT_PAYMENT_EVENT));
        requestAnimationFrame(() => document.getElementById("dues_payee_name")?.focus());
      }}
      className={HEADER_BUTTON}
    >
      Edit or Add Payment Details
    </button>
  );
}
