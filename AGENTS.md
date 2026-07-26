# Local development

- Run the Vite development server outside the restricted sandbox so it can reach
  the remote services configured by `BUDGET_API_ORIGIN`.
- When asked to run the project, use `npm run dev` with full network access and
  verify both `http://localhost:5175/` and at least one `/api/*` endpoint.
