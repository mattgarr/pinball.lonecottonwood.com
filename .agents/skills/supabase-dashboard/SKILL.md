---
name: supabase-dashboard
description: >-
  Run SQL migrations, call host RPCs, and deploy Edge Functions for the Pinball Wizard
  Supabase project (llmggdjxiffkwnjuogxf) via Chrome remote debugging (CDP) or direct
  PostgREST RPC calls. Use for any schema change, RPC change, grant, or edge-function deploy.
---

# Supabase Operations (`llmggdjxiffkwnjuogxf`)

## 1. Calling Existing Host RPCs Directly (No Browser Needed!)
Many admin actions (`host_save_event`, `host_set_current_event`, `host_set_entry`, `host_add_invites`, `host_invites`, `host_link_player`, `host_walkins`, `host_clear_scores`) are already `security definer` RPCs callable directly from the shell using the publishable key in `web/src/lib/store.js` and the passcode on line 3 of `HOST_PASSCODE.txt`:
```bash
PASS=$(sed -n '3p' HOST_PASSCODE.txt | tr -d '\r\n')
KEY="sb_publishable_7oGSOVFpRFVnJ5SeRcjYsQ_a6EQyojv"
URL="https://llmggdjxiffkwnjuogxf.supabase.co/rest/v1/rpc"
```
**Never print `$PASS` in chat or logs.**

## 2. Running DDL / SQL Migrations via Chrome CDP (`connectOverCDP`)
There is no Supabase CLI login or DB password. To run new `supabase/migrations/00NN_*.sql` files:
1. Connect to the user's running Chrome via Playwright `chromium.connectOverCDP` reading the WebSocket path from `~/Library/Application Support/Google/Chrome/DevToolsActivePort`.
2. **Use ONE long-lived connection** so Chrome only prompts `"Allow remote debugging?"` once.
3. On `https://supabase.com/dashboard/project/llmggdjxiffkwnjuogxf/sql/...`, set the Monaco editor value directly:
   ```js
   window.monaco.editor.getModels()[0].setValue(sql);
   ```
   and click **Run** (confirming the **"Run this query"** modal if `DROP` or `DELETE` is present).
4. Always save the migration to `supabase/migrations/00NN_*.sql` and commit it to `main`.

## 3. Supabase Schema & RPC Gotchas
- **Auto-expose is off.** Grant explicitly:
  - `grant select on public.<table> to anon, authenticated;`
  - `grant execute on function public.<fn>(...) to anon, authenticated;`
  - `revoke all on function public.<helper>(...) from public, anon, authenticated;`
- **Changing an RPC's argument list**: `drop function` the old signature first so PostgREST doesn't see ambiguous overloads.
- **Multi-event safety**: Never assume `_current_event()` inside ticket/invite RPCs (`claim_invite`, `my_ticket`, `set_ticket_email`, `set_ticket_who`) when a ticket row (`v_inv.event_id`) is known—always scope to the ticket's own `event_id` so flipping active tournaments doesn't cross-contaminate events.
