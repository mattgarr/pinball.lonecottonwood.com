---
name: supabase-dashboard
description: Run SQL migrations and deploy Edge Functions for the Pinball Wizard Supabase project (llmggdjxiffkwnjuogxf) by driving the Supabase dashboard in the built-in browser. Use for any schema change, RPC change, grant, or edge-function deploy.
---

# Supabase changes via the dashboard

Project: `llmggdjxiffkwnjuogxf` (org "Lone Cottonwood"). The user is signed in in the built-in browser pane.
There's no CLI login or DB password; everything goes through the dashboard editors.

## Running SQL
1. Navigate to `https://supabase.com/dashboard/project/llmggdjxiffkwnjuogxf/sql/new` and wait about 3s.
2. Click into the editor (about 500,200 on the 800×700 screenshot frame).
3. Use `computer type` with the full SQL. **Pasting doesn't work**: the pane doesn't get the system clipboard.
   - The editor doesn't auto-close brackets or quotes. It only re-indents, which SQL ignores.
4. Press Escape (closes autocomplete), then click **Run** (about 745,101).
5. A "Potential issue detected / destructive operations" dialog appears for DROP or DELETE, even inside function bodies. Confirm with **Run query** (about 515,427) when that's expected.
6. Check the result with `find "Success"`, then verify from the shell with curl against `/rest/v1/...` using the publishable key in `web/src/lib/store.js`.
7. Always save the SQL to `supabase/migrations/NNNN_*.sql` too.
8. Clear secrets out of the editor afterwards: replace the text with a harmless query.

## Gotchas
- **Auto-expose is off.** New tables get no grants. Grant explicitly:
  - `grant select ... to anon, authenticated` for public reads
  - `grant select ... to service_role` for edge functions (e.g. `machines`)
- Writes go only through `security definer` RPCs. Add `grant execute ... to anon, authenticated` for new public RPCs, and `revoke ... from public, anon, authenticated` for internal helpers.
- Changing an RPC's argument list means `drop function` the old signature first, or PostgREST sees two overloads.
- Supabase blocks direct deletes from `storage.objects` in SQL. Don't put that in `host_wipe`.

## Deploying an Edge Function
1. For a new function, go to `.../functions/new`; to edit, go to the function's Code tab.
2. Strip leading indentation from the source first (the editor re-indents and the indentation would pile up):
   `sed 's/^[[:space:]]*//' supabase/functions/<name>/index.ts | grep -v '^$' > scratch.ts`
3. Click the editor, `cmd+a`, Delete, then `type` the flattened code.
4. Verify it's exact (read-only inspection):
   `window.monaco.editor.getModels()[0].getValue()` → compare trimmed, non-empty lines and character count with the file.
5. Set the name (textbox "Give your function a name..."), then **Deploy function**.
6. Settings: **Verify JWT** stays OFF for functions that check the app's own player token (e.g. `read-score`).
7. The service key in a function: `SUPABASE_SERVICE_ROLE_KEY`, falling back to the first value of the JSON in `SUPABASE_SECRET_KEYS`.

## Small edits to a deployed function (faster than retyping)
In the function's Code tab: click the editor, press `cmd+alt+f` (find), type the exact old text, press Escape (the match stays selected), and type the new text. Then check with `getModels()[0].getValue()` that the old text is gone and the character count matches the file, and click **Deploy updates** by screen coordinate (clicking it via a find/read_page ref sometimes does nothing). A **"Confirm to deploy updates" dialog** appears: click its Deploy updates button (center of the dialog). Then wait for the "Successfully updated edge function" toast; if it doesn't appear, the deploy didn't happen. It takes ~1 min to go live; poll until the response changes.

## Gemini gotchas (read-score)
- `gemini-3.8-flash` rejects `thinking_level: 'minimal'` (400). Use `'low'`.
- Use the Interactions API (`/v1beta/interactions`, header `Api-Revision: 2026-05-20`). Inline image part: `{type:'image', data, mime_type}`. Video part: `{type:'video', data, mime_type, processing:{type:'static', fps}}`.
- Several images in ONE call with thinking `medium` took ~60s. Parallel single-image calls (thinking `low`) are much faster; vote in code.
- Function logs: `.../functions/read-score/logs`. Search for "gemini error" and "read-score" (per-call summary JSON).

## Secrets
Edge Functions → Secrets (`.../functions/secrets`). **Claude never types API keys or tokens into any site.** Open the page and have the user paste the value. `read-score` needs `GEMINI_API_KEY` (it also finds a key saved under another name, e.g. the current secret "Pinball Wizard") (AI Studio key "Pinball Wizard score reader", project gen-lang-client-0027899820, billed to DefaultBilling, which holds the Ultra $40/month credit).
