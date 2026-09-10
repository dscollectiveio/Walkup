"use client";

import { useActionState, useRef } from "react";
import { addExpenseCategory } from "./actions";

export function AddCategoryForm({ associationId }: { associationId: string }) {
  const [state, action, pending] = useActionState(addExpenseCategory, null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) => {
        action(formData);
        formRef.current?.reset();
      }}
      className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4"
    >
      <input type="hidden" name="association_id" value={associationId} />
      <div className="flex-1 min-w-[12rem]">
        <label htmlFor="new-category-name" className="block text-[12px] font-medium text-ink">
          Add a category
        </label>
        <input
          id="new-category-name"
          name="name"
          type="text"
          placeholder="e.g. Pool Maintenance"
          className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      {state?.error ? (
        <span className="w-full text-[11px] text-bad-text">{state.error}</span>
      ) : null}
    </form>
  );
}
