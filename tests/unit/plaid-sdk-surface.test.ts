import { describe, expect, it } from "vitest";
import {
  CountryCode,
  PlaidApi,
  Products,
  type AccountsBalanceGetRequest,
  type AccountsGetRequest,
  type ItemPublicTokenExchangeRequest,
  type ItemRemoveRequest,
  type ItemWebhookUpdateRequest,
  type LinkTokenCreateRequest,
  type TransactionsSyncRequest,
  type WebhookVerificationKeyGetRequest,
} from "plaid";

/**
 * The Plaid Node SDK calls Walkup makes. Compile-time: each request literal
 * must satisfy the SDK's type, so a major upgrade that renames a field fails
 * `tsc`. Runtime: each method must still exist on PlaidApi.
 */
describe("plaid SDK surface Walkup depends on", () => {
  it("keeps the request shapes and methods in use", () => {
    const requests = {
      linkTokenCreate: {
        user: { client_user_id: "u" },
        client_name: "Walkup",
        products: [Products.Transactions],
        country_codes: [CountryCode.Us],
        language: "en",
        transactions: { days_requested: 730 },
        redirect_uri: "https://example.test/bank-feed/oauth",
        webhook: "https://example.test/api/plaid/webhook",
        access_token: "t",
      } satisfies LinkTokenCreateRequest,
      itemPublicTokenExchange: { public_token: "p" } satisfies ItemPublicTokenExchangeRequest,
      transactionsSync: { access_token: "t", cursor: "c" } satisfies TransactionsSyncRequest,
      accountsBalanceGet: { access_token: "t" } satisfies AccountsBalanceGetRequest,
      accountsGet: { access_token: "t" } satisfies AccountsGetRequest,
      itemRemove: { access_token: "t" } satisfies ItemRemoveRequest,
      itemWebhookUpdate: { access_token: "t", webhook: "https://example.test" } satisfies ItemWebhookUpdateRequest,
      webhookVerificationKeyGet: { key_id: "k" } satisfies WebhookVerificationKeyGetRequest,
    };
    for (const method of Object.keys(requests)) {
      expect(typeof PlaidApi.prototype[method as keyof PlaidApi], method).toBe("function");
    }
  });
});
