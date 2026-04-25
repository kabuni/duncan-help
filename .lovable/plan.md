# Repoint `CHAT_URL` to ngrok endpoint

## Change

In `src/hooks/useNormanChat.ts`, replace **only** the `CHAT_URL` constant so the chat hook calls the local/ngrok-tunnelled backend instead of the Supabase edge function.

## Note on line number

Your message says "line 17", but in the current file the `CHAT_URL` declaration is on **line 26**. Line 17 is a blank line inside an interface block. I will change the actual `CHAT_URL` line — that is unambiguously the one you described.

## Edit

File: `src/hooks/useNormanChat.ts`, line 26

From:
```ts
const CHAT_URL = `${FUNCTION_BASE_URL}/norman-chat`;
```

To:
```ts
const CHAT_URL = `https://encore-catalyst-jugular.ngrok-free.dev/norman-chat`;
```

## Not changed

- `EXTRACT_URL`, `FASTAPI_CHAT_URL`, `FUNCTION_BASE_URL`, and every other line in the file remain untouched.
- No other files are modified.

## Side effects to be aware of

- All `norman-chat` traffic from the app will go to the ngrok tunnel. If the tunnel is down, the main chat will fail.
- Auth headers, streaming behaviour, and request bodies stay identical — the ngrok server must accept the same `Authorization: Bearer <supabase jwt>` header and SSE response shape as the edge function.
