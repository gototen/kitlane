# Deferred: optional AI adapter (`kitlane.ai.chat`)

**Status: not implemented in v0.2.** The SDK method `kitlane.ai.chat()` throws `KitlaneError("capability_unavailable")`, and `/._kitlane/ai/*` on every tool origin returns `501 capability_unavailable`. `kitlane.tool().capabilities.ai` is `false`. This document captures the design so the work is not lost. The specification marks it conditional and first to cut when the schedule slips, which it did.

## Purpose

Let a hosted tool call a model through Kitlane without the tool author handling a provider key. The server holds the key, verifies the user, the registered tool, a capability grant, the allowed model, and per-user and per-tool budgets, then records operational usage without logging prompt or response content.

## SDK surface

```ts
const result = await kitlane.ai.chat({
  messages: [{ role: "user", content: "Summarise the risks for Acme" }],
  system?: string,
  model?: string,          // must be in the installation's allowed list; default from config
  maxTokens?: number,      // capped by the installation
});
// result: { text: string, model: string, usage: { inputTokens: number, outputTokens: number } }
```

Errors: `capability_unavailable` (not enabled for this installation or tool), `forbidden` (no grant), `quota_exceeded` (budget), `rate_limited` (concurrency or rate), `payload_too_large` (request bounds), `bad_request` (unknown model, malformed messages). Streaming is out of scope for the first version.

## Server route

`POST /._kitlane/ai/chat` on the tool origin, protected like the data routes: tool from the host, user from the tool session, same-origin check, JSON body, freeze gate, rate limiter. No route exists on the portal origin and nothing is exposed to updater credentials.

## Data model

```sql
CREATE TABLE capability_grants (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,                 -- 'ai'
  allowed_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_budget_cents INTEGER NOT NULL,       -- per calendar month
  user_budget_cents INTEGER NOT NULL,       -- per user per calendar month
  max_concurrency INTEGER NOT NULL DEFAULT 4,
  granted_by TEXT REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE ai_usage (
  id SERIAL PRIMARY KEY,
  tool_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_cents NUMERIC(10,4) NOT NULL,
  reserved_cents NUMERIC(10,4) NOT NULL,    -- reservation made before the call
  status TEXT NOT NULL,                     -- 'reserved' | 'settled' | 'failed'
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

No prompt or response content is stored anywhere. Grants are audited (`capability.granted`, `capability.revoked`) like collection grants.

## Checks on every call

1. Tool session present; tool not frozen; installation has AI enabled (`KITLANE_AI_PROVIDER` set).
2. An active `capability_grants` row for this tool with `capability = 'ai'`.
3. Requested model (or the default) is in `allowed_models` and in the installation's global allow list.
4. Request bounds: total message bytes under `KITLANE_AI_MAX_REQUEST_BYTES`, `maxTokens` under the grant's or installation's cap.
5. Concurrency: in-flight calls for this tool under `max_concurrency` (in-memory counter per process; one process is the design point).
6. Budget with reservation: inside one transaction, sum settled plus reserved cost for the tool and for the user this month; if adding the worst-case cost (input estimate plus `maxTokens` at the model's output price) would exceed either budget, reject with `quota_exceeded`; otherwise insert a `reserved` usage row. After the provider responds, settle the row with actual tokens and cost (or mark `failed`). Reservations make concurrent calls unable to bypass budgets.
7. Call the provider with the server-side key; return text and usage.

## Provider adapter

```ts
interface ModelGateway {
  chat(input: { system?: string; messages: Message[]; model: string; maxTokens: number; signal: AbortSignal }): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
  price(model: string): { inputPerMillionCents: number; outputPerMillionCents: number };
  models(): string[];
}
```

One implementation first: Anthropic Messages API, key in `KITLANE_AI_ANTHROPIC_API_KEY`, default model `KITLANE_AI_DEFAULT_MODEL`, allowed models `KITLANE_AI_ALLOWED_MODELS`, timeouts `KITLANE_AI_TIMEOUT_MS`. The interface is an ordinary code boundary; other providers or a company model gateway would implement the same three methods.

## Operator policy knobs

`KITLANE_AI_PROVIDER` (unset means disabled), provider key, default and allowed models, global monthly budget, default per-tool and per-user budgets for new grants, max request bytes, max output tokens, timeout, concurrency default. Grants are created by administrators from the tool's detail page or `kitlane-server grant-capability <tool> ai --tool-budget 2000 --user-budget 200`. Usage summaries (counts and cost by tool and month, never content) appear on the admin page.

## What the examples would show

`kit/prep` gains an "Ask about this company" box that sends the brief as context and shows the answer, with a visible note that the installation's model provider processes the text. When the grant is missing, the box shows "AI is not enabled for this tool on this installation" (capability reporting, not a silent failure). Copies of `prep` inherit no grant, demonstrating "an action that needs unavailable AI authority reports the missing capability".

## Tests to write

- Tool without a grant gets `forbidden`; installation without a provider gets `capability_unavailable`.
- Model outside the allow list is rejected.
- Request over the byte bound and `maxTokens` over the cap are rejected.
- Concurrent calls cannot exceed the budget: N parallel requests whose worst-case costs sum above the budget result in exactly as many successes as the budget allows.
- Settlement reduces the reservation to the actual cost; failed calls release it.
- Usage rows contain no prompt text.
- Copies of a granted tool have no grant.
- Freeze blocks the route.

## Estimated effort

About one day: route and checks (half a day), Anthropic adapter and config (a quarter), admin grant UI and CLI subcommand plus tests (a quarter). The prep example change is an hour.

## Open questions

- Provider data handling and retention: an operator decision, stated to users in the tool.
- Logging policy: the design logs no content by default; some installations may want opt-in debug logging with a short retention. Make it explicit rather than ambient.
- Pricing tables change; store prices in configuration, not code, and record the price used on each usage row.
- Whether a company model gateway should be the first adapter instead of a direct provider; the interface supports either.
