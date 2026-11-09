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

## Email templates
For anything about HTML email (Gmail dark mode, sizes, samples), use the `html-email` skill.

## Bigger function edits
Monaco's regex find didn't select across lines. Instead, retype the whole file: click the editor, `cmd+a Delete`, then type the flattened file.

Verify with a SHA-256 of the trimmed non-empty lines: `crypto.subtle` in the page vs `hashlib` in the shell.

If the Deploy button is off-screen, resize the pane to 1280×900.

## Gemini gotchas (read-score)
- `gemini-3.8-flash` rejects `thinking_level: 'minimal'` (400). Use `'low'`.
- Use the Interactions API (`/v1beta/interactions`, header `Api-Revision: 2026-05-20`). Inline image part: `{type:'image', data, mime_type}`. Video part: `{type:'video', data, mime_type, processing:{type:'static', fps}}`.
- Several images in ONE call with thinking `medium` took ~60s. Parallel single-image calls (thinking `low`) are much faster; vote in code.
- Speed benchmark (2026-11-07, 13 verified stills): 3.8 Flash single still 2.9 s median, 100% correct. Per-image `resolution: 'low'|'medium'` on the image part is accepted (`generation_config.media_resolution` is NOT) but doesn't speed things up and 'low' adds errors. `gemini-3.5-flash-lite` is ~1.1 s but 6–10% wrong (repeatable slot swaps), so don't use it for scores. On rolling-shutter-banded stills a single read is confidently wrong ~6%; two stills that agree exactly had 0 errors (the scanner's fast path relies on this).
- Image generation (`pixel-avatar`, model `gemini-3.1-flash-image`, ~7 s): `response_format {type:'image', mime_type:'image/jpeg', aspect_ratio:'1:1', image_size:'512'}`. PNG output and `'0.5K'` are rejected (400); valid sizes are '512', '1K', '2K', '4K'.
- `pixel-avatar` callers: host `{pass, player_id}`, player `{token, image}` (photo_gate), or pre-join `{image}` (gated by `avatar_gate_anon()`, 200/hour party-wide, migration 0005).
- Calling a function with curl needs the `apikey: <publishable key>` header, or the gateway returns 401. The host passcode is line 3 of HOST_PASSCODE.txt.
- Function logs: `.../functions/read-score/logs`. Search for "gemini error" and "read-score" (per-call summary JSON).

## Secrets
Edge Functions → Secrets (`.../functions/secrets`). **Claude never types API keys or tokens into any site.** Open the page and have the user paste the value. `read-score` needs `GEMINI_API_KEY` (it also finds a key saved under another name, e.g. the current secret "Pinball Wizard") (AI Studio key "Pinball Wizard score reader", project gen-lang-client-0027899820, billed to DefaultBilling, which holds the Ultra $40/month credit).
