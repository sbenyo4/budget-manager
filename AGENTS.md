# Local development

- Run the Vite development server outside the restricted sandbox so it can reach
  the remote services configured by `BUDGET_API_ORIGIN`.
- When asked to run the project, use `npm run dev` with full network access and
  verify both `http://localhost:5175/` and at least one `/api/*` endpoint.

# Credit-card data verification

- Localhost normally proxies every `/api/*` request to the production origin in
  `BUDGET_API_ORIGIN`. A change in `server/openFinance.ts` is therefore not live
  in the local UI until that server code is deployed, or until a separate local
  run is started with `BUDGET_API_ORIGIN` empty.
- Never claim that a credit-card data fix is complete from unit tests alone.
  Before deployment, use the locally stored Open Finance service settings for a
  read-only comparison of raw provider rows, normalized rows, bank debit detail
  counts, and detail totals. Every attached detail total must equal its booked
  bank debit exactly.
- Treat separate `BOOKED` provider IDs and separate `billingDate` values as real
  transactions. Installment cycles can legitimately share card number,
  transaction date, merchant, and amount. Only merge a confirmed provider alias,
  such as the matching `PENDING`/`BOOKED` pair with incomplete billing metadata.
- When the provider includes `chargedAmount` but its value is an empty string,
  treat the charged amount as zero instead of falling back to `originalAmount`.
  Keep that zero-value item in an attached debit's detail list so counts remain
  faithful without inflating the debit total.
- Regression reference for the 2026-08-10 incident: the booked debit of
  ILS 2,115.51 must contain 14 details totaling ILS 2,115.51, and the booked
  debit of ILS 1,714.82 must contain 9 details totaling ILS 1,714.82.
- Before production, run the full test suite and production build, verify the
  live-data comparison locally, deploy the already-tested artifact, confirm the
  production alias serves the new bundle and an `/api/*` endpoint returns 200,
  then hard-refresh the UI so it refetches transactions.
