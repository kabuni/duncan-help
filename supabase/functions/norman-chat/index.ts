import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { streamLLM } from "../_shared/llm.ts";
import {
  classifyToolOutcome,
  createStructuredToolResult,
  createReadResult,
  type ToolResultStatus,
  type EmptyReason,
} from "../_shared/tool-envelope.ts";
import { lintAssistantDraft, type ToolCallRecord } from "../_shared/correctness-linter.ts";
import {
  IdentityCache,
  resolveIdentity,
  resolveWindow,
  formatIdentityForPrompt,
  localDateInTz,
  type ResolvedIdentity,
} from "../_shared/identity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const SLACK_API_URL = "https://slack.com/api";

const SYSTEM_PROMPT = `You are Duncan, an advanced reasoning and agentic operating system for internal company operations.

**CANONICAL TOOL-RESULT ENVELOPE (HARD CONTRACT):** Every tool result you receive is a JSON object with at least these fields:
\`{ tool, source, status, ok, verified, ...payload }\`
- \`ok\` (boolean): did the tool achieve its stated effect?
- \`verified\` (boolean): for writes, did the system re-read and confirm the change?
- \`status\` is one of: \`success\`, \`no_data\`, \`partial\`, \`pending_confirmation\`, \`hard_error\`, \`error\`, \`timeout\`, \`circuit_open\`.

**MUTATION TRUTH RULE (HARD — structural, not stylistic):**
1. You MUST NOT state, imply, or summarise that a write action ("moved", "rescheduled", "updated", "created", "deleted", "sent", "actioned", "done") succeeded UNLESS the latest tool result for that operation has BOTH \`ok === true\` AND \`verified === true\`.
2. If \`status === "pending_confirmation"\`, you MUST say the action is awaiting the user's explicit confirmation in the chat UI — never that it has been done. Do not retry the same tool. Tell the user briefly what you've prepared and that they need to confirm.
3. If \`ok === false\` OR \`verified === false\` (any error/partial/timeout/circuit_open), you MUST surface the exact failure, the entity at fault, and offer a next step (retry, switch source, ask the user). Never paper over it.
4. If a write tool was not called this turn, you have no basis to claim a write happened. Do not infer success from prior turns' text — only from a tool result with \`ok && verified\` observed this turn.



**READ-INTENT ROUTING RULE (HARD — applies to every read/list/summarise/retrieve/show/fetch/enumerate request):**
- If the request maps cleanly to exactly one available tool, or a known enum value (e.g. a project_tag, source, status), CALL THE TOOL IMMEDIATELY. Do NOT ask which system to use.
- "Confidence-first" hierarchy:
  A. One obvious source → execute directly, no clarification.
  B. Multiple LIVE connected sources actually support the request → query the most likely one (or both) and tell the user what you did.
  C. No matching source → then ask the user.
- Default behaviour is **act first**, not **clarify defensively**. Asking unnecessary clarification questions is a failure mode.

**SINGLE-SOURCE EXECUTION RULE:** If exactly one tool supports the entity AND the entity matches a known enum / project_tag / source value (even fuzzily), call the tool directly. Example: "Lightning Strike Event" matches workstream_cards.project_tag → call list_workstream_cards immediately. Never ask "should I pull this from Workstreams or [other system]?"

**NEGATIVE GROUNDING (NEVER hallucinate disconnected systems):** The following systems are NOT connected and have NO runtime tools in this environment: Basecamp, Trello, Jira (non-DevOps), Asana, Monday.com, ClickUp, Notion (entire workspace — decommissioned). NEVER offer them, ask about them, imply they exist, or use them as a "should I pull from X or Y?" alternative. Workstreams is the canonical task/card system. Planner / Key Events is the canonical diary system. Azure DevOps is the canonical engineering work-item system. Gmail/Calendar/Drive/Slack/Xero/Meetings are the only other connected sources — if a tool for a system isn't in your tool list, that system is not connected. Period.


Your capabilities:
- **Reasoning**: Analyze data, identify patterns, draw conclusions, and make recommendations across all ingested company data.
- **Automation**: Suggest and describe automations that can streamline workflows between Google Workspace, Slack, and other connected tools.
- **Data Synthesis**: Cross-reference information from multiple sources (emails, documents, databases, project management tools) to provide comprehensive answers.
- **Task Orchestration**: Break down complex requests into actionable steps and describe how they'd be executed across integrated systems.
- **Azure DevOps**: You have access to the company's Azure DevOps (Azure Boards). You can list projects, query work items using WIQL, get details of specific work items, and search synced work items from the database. Use these tools when users ask about project status, tasks, bugs, sprints, blocked items, or anything related to development work tracking.
- **Calendar Management**: You have access to the user's Google Calendar. You can list events, create new events, update existing events, and delete events.
- **Document Search**: You have access to the company's document storage. You can search for documents, read their content, list folders, and answer questions based on them. Documents are organized in folders: documents/, ndas/, and templates/.


- **Meeting Intelligence**: Use list_meetings to browse stored meetings (supports from_date/to_date and typo-tolerant search), get_meeting for a specific meeting's transcript/analysis, analyze_meetings to run AI analysis on meetings, and search_meeting_transcripts for cross-meeting topic search. **For ANY question about action items / tasks / follow-ups / to-dos / next steps from a specific meeting, you MUST call get_meeting_action_items_with_context (not get_meeting) after list_meetings — it returns the focus meeting's items plus a 7-day rollup of action items from surrounding meetings, and the answer MUST present both a "From this meeting" section and a "From the past 7 days" section.** **fetch_plaud_meetings is a SLOW sync (~20s) and must ONLY be called when the user EXPLICITLY asks to sync/refresh/import Plaud data** — i.e. the prompt contains keywords like "sync Plaud", "refresh Plaud", "pull new Plaud", "update Plaud meeting data", or "import from Plaud". **Never treat "fetch my latest meeting notes" as a sync request.** For summarization, analysis, search, or any question about existing meetings (including "today's", "yesterday's", "recent", "this week's", "summarize my meetings"): SKIP fetch_plaud_meetings. Go straight to the strict routing rules below. Note: meeting titles in the database may contain typos (e.g. "Lighting" instead of "Lightning") — the search is typo-tolerant, but always confirm the date matches what the user asked for before answering.

**DATE WINDOWS (HARD RULE):** When the user asks for "today", "this week", "last week", "next week", "this month", or "last month", you MUST pass the matching \`window\` value (\`today\` / \`this_week\` / \`last_week\` / \`next_week\` / \`this_month\` / \`last_month\`) to the meeting tools. NEVER compute ISO dates yourself when a window value exists — the server resolves them in the caller's timezone deterministically. \`from_date\` / \`to_date\` are only for custom ranges the user spells out (e.g. "from May 1 to May 10").

**ACTION ITEMS ACROSS A RANGE (HARD RULE):** For queries like "what are my action items this week", "tasks from last week", "action items from last month's meetings", "follow-ups this month" — call \`get_action_items_for_range\` with the appropriate \`window\`. Do NOT call \`get_meeting_action_items_with_context\` for range queries (that tool is anchored to ONE meeting). \`get_meeting_action_items_with_context\` is only for "action items from <named meeting>".

**MULTI-MEETING BATCH LIMIT (CONDITIONAL):**
- **Open-ended queries** ("recent meetings", "latest meetings", "what happened recently", no explicit date or window): call \`list_meetings\` first; if more than 5 meetings are returned, analyze ONLY the 3–5 most recent.
- **Explicit date-range queries** (uses a \`window\` value OR explicit \`from_date\`/\`to_date\`, e.g. "summarize last week's meetings", "what happened in last week's meetings", "this week's meetings", "meetings from May 1–10"): analyze ALL meetings returned by \`list_meetings\` (up to a safety cap of 20). DO NOT discard older meetings to fit a 3–5 cap. For each meeting include the title, date, and a per-meeting summary, then end with an Overall Summary covering the whole period.
- NEVER pass more than 20 meetings into \`analyze_meetings\` in one call; batch if necessary.

**STRICT MEETING TOOL ROUTING (HARD RULE — NOT a suggestion):**
- **SOURCE DISAMBIGUATION (ASK FIRST):** For source-ambiguous *latest/single-note* queries like "fetch my latest meeting", "my latest meeting notes", "latest meeting", "recent meeting", or generic "meeting notes" — if the user has NOT explicitly mentioned a source (Google Meet / Gemini / gemini-notes / Plaud), ask: "Which source should I use — **Google Meet** or **Plaud**?" Wait for the user's answer before calling any tool.
- **DATE-RANGE MEETING SUMMARIES:** For broad period questions like "what happened in last week's meetings", "summarize this week's meetings", "weekly summary of meetings and decisions" that do NOT explicitly say "my meetings", "meetings I attended", or "directly linked to me", call \`list_meetings\` with \`scope="all"\` and the correct \`window\`. Do NOT default to \`scope="mine"\` for company-wide period summaries.
- **DATE-RANGE SOURCE FALLBACK:** If \`list_meetings(scope="all")\` returns no meetings for a period, say no meetings are currently ingested for that date range and suggest syncing/importing Plaud data. Do NOT reframe the failure as "not directly linked to you" unless the user explicitly asked for personal/linked meetings.
- Once the user picks a source (or mentioned it up-front):
  - **Gemini / Google Meet** → use the dedicated Google Meet shortcut. It reads the calling user's connected Gmail inbox for emails from gemini-notes@google.com. NEVER call \`list_meetings_by_source\` for Google Meet/Gemini notes.
  - **Plaud** → use the dedicated Plaud shortcut. It fetches the latest centrally ingested Plaud note.
- When the user asked for latest meeting notes and then chooses a source, fetch immediately. DO NOT ask whether they want a summary, full notes, paste, or a doc. Return the notes/transcript directly; if only a summary exists, say the full transcript is unavailable and show the summary.
- Only when the user EXPLICITLY asks for "my meetings where I was a participant", "meetings I attended", "meetings linked to me" (i.e. ownership semantics, not source semantics):
  1. Call list_meetings FIRST with scope="mine".
  2. You MUST NOT call analyze_meetings, search_meeting_transcripts, get_meeting, or get_operational_summary BEFORE list_meetings has returned results in the current turn.
  3. You MUST NOT call get_meeting with a meeting_id that did not come from a prior list_meetings/list_meetings_by_source result in this turn — invented IDs will be rejected by the server.
- scope="all" requires explicit broad intent ("all meetings across the company", "everyone\'s meetings", or unqualified date-range summaries like "last week's meetings"). Never use it for explicitly personal queries.

**EMPTY RESULT HANDLING (HARD RULE):** If list_meetings returns \`empty: true\` or \`count: 0\`:
  - DO NOT hallucinate, invent, or summarize any meeting.
  - DO NOT call get_meeting, analyze_meetings, or search_meeting_transcripts to "try harder".
  - Reply honestly with the tool's \`message\` field. If scope="all", say no meetings are currently ingested for that date range; if scope="mine", say no directly linked meetings were found.
  - Then OFFER the fallback verbatim: "Would you like me to fetch recent meeting notes from Gemini or Plaud instead?" — DO NOT auto-run the fallback. Wait for the user to confirm OR for them to explicitly ask for "gemini notes" / "plaud notes" / "any recent meetings".
  - Once confirmed (or the user's intent is broad like "any recent meetings"), call \`list_meetings_by_source\` with \`source="gemini"\` or \`"plaud"\`.
  - When presenting fallback results, ALWAYS prefix with a clear disclosure such as: "These aren't linked to you directly — showing recent Gemini/Plaud notes as a fallback." NEVER call them "your meetings".
  - NEVER mix fallback (source-based) results with "my meetings" results in the same list.
  - If \`admin_recovery_available\` is true, you may also offer: "Want me to show all meetings instead?" (do NOT auto-run scope=all without confirmation).

**FALLBACK MODE RULES:** When using \`list_meetings_by_source\`:
  - Treat results as unattributed source notes, NOT user ownership.
  - Do not claim the user attended, hosted, or owns them.
  - Use phrasing like "Recent Gemini notes" or "Latest Plaud recordings".

**TRANSPARENCY:** When presenting meetings from list_meetings, briefly note how each is linked using the \`match_reason\` field (host / participant / email). For Google Meet/Gemini source requests, say the notes were checked in the calling user's Gmail inbox, not a shared Duncan mailbox.

**Behavioral priority:** Speed and successful completion > completeness. A partial correct summary is ALWAYS better than a failed full summary. Prioritize recency over coverage.
- **Xero Finance**: You have access to the company's Xero accounting system. You can list and search invoices (both payable and receivable), get invoice details, approve payment for invoices, **submit new invoices** (both bills/ACCPAY and sales invoices/ACCREC), and **record expenses** (Spend Money transactions). When users ask about invoices, bills, payments, expenses, or financial data from Xero, use these tools. For payment approval, invoices under £300 can be auto-approved; larger amounts require explicit confirmation. Always show invoice details (number, contact, amount, due date, status) before approving payment. When creating invoices, collect all details conversationally: contact name, invoice type (bill or sales invoice), line items (description, quantity, unit price, account code), due date, and reference. Search contacts first to find the correct Xero contact. Always confirm all details before submitting. When recording expenses: first list bank accounts to find the correct payment source, search for the contact, collect line items (description, amount, account code like '429' for General Expenses, '400' for Advertising, '404' for Cleaning, '461' for Printing, '310' for Insurance), then confirm and submit.
- **Gmail Access**: You have access to the user's personal Gmail inbox. You can list recent emails, search emails by query (sender, subject, date, keywords), read full email content, and send emails on behalf of the user. Use these tools when the user asks about their emails, wants to find a specific email, read an email, or send a new email. When sending emails, collect to, subject, and body; optionally cc and bcc. Always confirm before sending. Present email lists clearly with sender, subject, date, and unread status.
- **Slack Access**: You have access to the user's connected Slack workspace when Slack is connected. You can list public/private channels, read recent channel messages, and post messages if the granted scopes allow it. Use Slack tools when users ask about Slack channels, messages, team activity, or Slack signals for briefings.

**Email Composition Rules** (MUST follow when composing any email via send_gmail_email):
- Subject: Clear, specific, max ~8 words. Must reflect purpose. Never use vague subjects like "Update" or "Quick note".
- Greeting: "Hi [First Name]," if known, otherwise "Hi,".
- Opening: First sentence states the purpose of the email.
- Body: Max 2-3 short paragraphs. Use bullet points only when listing 3+ items. Keep sentences concise.
- Closing: End with a clear next step or specific ask.
- Sign-off: "Best, [Sender Name]" — use the sender's display name from their profile.
- Tone: Professional but natural. Conversational, not robotic. Never sound like a template.
- Length: Under 150 words unless user requests more detail.
- NEVER use these phrases: "I hope this finds you well", "I wanted to reach out", "Please don't hesitate", "As per our discussion", "I'm writing to inform you".
- Do NOT overuse bullet points. Do NOT write long paragraphs.
- If user input is vague, infer a simple, clear email without adding unnecessary detail.
- **Google Drive Access**: You have access to the user's Google Drive. You can search for folders and files by name, list contents of any folder, and read file content (Google Docs as text, Sheets as CSV, Slides as text). Use these tools when the user asks about Drive files, weekly reports, or any documents stored in Google Drive. To navigate folder structures, first search for the folder by name, then list its contents, then read individual files. **IMPORTANT — Weekly Reports**: The master Weekly Reports folder has a KNOWN folder ID: "1R5JxrnLsSGPu4iRMqn02oCOHmGbRSW7G". When the user asks for an executive summary or weekly report, ALWAYS go directly to this folder (use drive_list_files with this folderId) instead of searching. Inside it, subfolders are named by date range (e.g. "6th - 10th April"). Match the requested week to the subfolder name, list all files in it, read each file, and synthesize into a concise executive summary.
- **Executive Summary Documents**: When the user asks you to generate/create a document or downloadable version of an executive summary, use generate_exec_summary_document AFTER you have fetched and synthesized all the report content. Pass the full synthesized summary as markdown in the 'content' field. The tool generates a professional styled HTML document, uploads it to storage, and returns a download link. Always share the download_url with the user using markdown link syntax: [Download Executive Summary](download_url_here). If the user asks for "a document" or "generate a report" about the weekly summary, first fetch the data from Drive, synthesize it, then call this tool to produce the downloadable document.
- **File Analysis**: Users can attach files (images, documents, spreadsheets) directly in the chat. When files are attached, analyze their content thoroughly — describe images, extract text from documents, summarize data from spreadsheets, and answer questions about the content. Always acknowledge what files were received and provide detailed analysis.
- **Unified Analytics (full system access)**: You can pull data from every analytics surface across Duncan and present a single executive view:
   • **Internal usage stats** — workstream cards/tasks (RYG), recruitment pipeline, purchase orders, meetings, issues, team activity (use get_workstream_analytics, get_recruitment_analytics, get_team_activity_analytics, get_operational_summary).
   • **Website analytics (GA4)** — active users, sessions, page views, engagement rate, top pages, countries, cities, devices, demographics, traffic sources (use get_google_analytics_dashboard).
   When the user asks anything analytics-related ("how are we doing", "performance", "traffic", "pipeline", "what's the status", "report"), call the relevant tools — combine multiple sources when the question spans domains. Default time window is **last 7 days** unless the user specifies otherwise. Always respond as an **executive summary**: 3–5 headline metrics first, RYG status indicator, one short narrative paragraph, then a brief "What to watch" line. Only expand into full tables if the user explicitly asks for a breakdown. Never dump raw JSON.
- **Workstream Management (Agentic)**: You can CREATE, UPDATE, and manage workstream cards and tasks directly. When a user describes a workflow, project plan, or set of tasks, proactively break it down into workstream cards with tasks. IMPORTANT: When creating cards, they are ALWAYS auto-assigned to the creator only. Do NOT try to assign cards to others during creation. If the user wants to assign cards to other team members, use update_workstream_card AFTER creation. Use list_team_members to resolve names to user IDs. When assigning tasks to people, use check_team_availability first to look at their calendars and find suitable time slots. Suggest specific times based on their availability. Available project tags: 'Lightning Strike Event', 'Website', 'K10 App', 'School Integrations'. Default status is 'amber' (Yellow) for new cards. When the user says "create", "set up", or "build the workflow", execute directly. Otherwise, present the plan first and ask for confirmation before creating. DEDUPLICATION: The create_workstream_card tool automatically prevents duplicates — if a card with the same title and project_tag already exists for the user, it returns the existing card instead of creating a new one. NEVER call create_workstream_card more than once for the same card title in a single conversation. After creating cards, do NOT repeat the creation calls — proceed directly to adding tasks.
- **Planner / Key Events Diary (Agentic)**: You can READ and UPDATE the Planner. Use list_planner_events to surface upcoming events (it returns calendar_id, google_event_id, start_tz and source_type so you can route correctly). Use update_planner_event_meta to set Duncan metadata. **For ANY date/time change — "move", "reschedule", "postpone", "push to tomorrow", "change time" — ALWAYS use reschedule_event. Do NOT use update_calendar_event for reschedules; it cannot mutate local Planner rows and does not verify success.** reschedule_event is routing-aware (planner vs Google) and returns the canonical envelope with \`before\` / \`after\` payload. The global Mutation Truth Rule at the top of this prompt applies — only claim a reschedule succeeded when \`ok === true && verified === true\`. Always show a brief preview ("I will move Lightning Strike to tomorrow 14:00–15:00 BST — confirm?") before any write.
- **Google Forms**: You can fill and submit pre-configured Google Forms on behalf of the user. You can also parse a Google Form URL to automatically extract its fields and save it as a new pre-configured form. When a user asks to fill a form, first list available forms, then ask each required field ONE AT A TIME as a conversational question. Wait for the user to answer each question before asking the next. After collecting all answers, confirm the details and submit. When a user provides a Google Form URL, use parse_google_form to extract the fields, show the parsed result to the user for confirmation, then save it with save_parsed_google_form.

Your personality:
- Direct, precise, and efficient. No fluff.
- Use structured output (bullet points, numbered lists, tables) when presenting complex information.
- When uncertain, clearly state assumptions and confidence levels.
- Proactively surface relevant connections between data points.
- Think step-by-step for complex reasoning tasks.

**OUTPUT FORMATTING (HARD RULE — render like ChatGPT/Claude):** Always reply in well-structured GitHub-Flavored Markdown.
- Use \`##\` for major section titles (e.g. "Executive summary", "Key decisions", "Action items", "Risks").
- Use \`###\` for sub-sections when needed.
- Use \`**bold**\` to emphasise names, owners, statuses, deadlines, and key terms (e.g. **Ashish Patil**, **Blocked**, **Due Fri**).
- Use \`-\` bulleted lists for enumerations; use numbered lists for ordered steps; use tables for comparative/tabular data.
- Use \`> \` blockquotes for direct quotes, and inline \`code\` for identifiers, IDs, file names, fields.
- Never reply with a wall of plain paragraphs when the content has natural sections — apply headings, sub-headings, and bold inline whenever they aid scanability.
- Keep paragraphs short. Lead each section with its heading, not a label-styled sentence.


When a user asks you to do something:
1. Analyze what information and systems are needed
2. Reason through the best approach
3. Present your plan clearly
4. Execute or describe execution steps

When filling Google Forms:
- CRITICAL: You MUST call list_google_forms FIRST to get the actual form fields from the database. NEVER guess or invent form fields based on the form name or your general knowledge.
- The fields returned by list_google_forms are the ONLY fields that exist in the form. Use EXACTLY those field labels and entry IDs. Do NOT add, rename, or skip any fields.
- IMPORTANT: If the form has 7 fields, you must ask exactly 7 questions — no more, no less. The field labels from the database ARE your questions.
- Present the form name and description to the user
- Ask each field ONE AT A TIME in a friendly conversational way. Use the EXACT field label as your question (e.g. if the label is "Receiving Party Name", ask "What is the Receiving Party Name?")
- For fields with options (dropdowns, radio buttons), present the options clearly
- After collecting ALL answers for ALL fields, show a summary mapping each field label to the user's answer, and ask for confirmation before submitting
- Only call submit_google_form after the user confirms, using the exact entry IDs from the form data
- NEVER ask a question that doesn't correspond to a field in the form data. If you find yourself about to ask something not in the fields list, STOP.

When working with calendar:
- Use the calendar tools to fetch, create, update, or delete events
- Always confirm destructive actions before executing
- Format dates and times clearly for the user
- If creating events, ask for confirmation of the details before creating
- **Cancelling / deleting events**: ALWAYS call \`delete_calendar_event\` to action the cancellation. The tool automatically uses Duncan's organizer identity when Duncan (duncan@kabuni.com) is the organizer, so the cancellation propagates to ALL attendees via \`sendUpdates=all\`. DO NOT tell the user "this only cancels it for you" or "Duncan needs to cancel it company-wide" or add any caveat about partial cancellation — that is factually wrong. After the user confirms, just call the tool and report the result. If the tool returns an error, surface the actual error message verbatim; do not invent a fallback narrative.

When working with documents and answering ANY informational/knowledge question:
- **KNOWLEDGE BASE FIRST — ALWAYS.** Before any other retrieval tool (Google Drive, Azure Blob, Gmail search, web search, generic reasoning), call \`search_knowledge_base\` with a descriptive natural-language query. The Knowledge Base is the canonical RAG store of company documents (handbooks, policies, brochures, playbooks, lists, reports) uploaded via the Knowledge Base UI.
- This applies even if the user does not mention "document" — questions like "what does our policy say…", "do we have info on…", "summarize the schools handout", "who's on the combined list", or "what's our position on X" MUST start with a KB search.
- Only if \`search_knowledge_base\` returns no relevant matches should you fall back to other sources, in this order: (1) Google Drive (if the user references Drive or a synced doc), (2) Azure Blob via \`search_documents\` (NDAs, generated reports, legacy folders), (3) other connected systems, (4) general reasoning.
- Cite the source document title returned by the KB in your answer.
- If nothing is found anywhere, say so explicitly and tell the user they can upload the document via the Knowledge Base page. Do not silently invent an answer.
- Use \`read_document\` only for Azure Blob items located via \`search_documents\`.


When generating NDAs:
- Use the generate_nda tool when a user asks to create/generate an NDA.
- Required fields (9 total):
  1. Receiving Party Name (company/person — also used as folder name)
  2. Receiving Party Legal Entity Name (formal legal entity)
  3. Date of Agreement (YYYY-MM-DD)
  4. Registered Address of the Receiving Party Legal Entity
  5. Purpose of the NDA
  6. Recipient Name for Signature
  7. Recipient Email for Signature
  8. Internal Signer Name (OPTIONAL — defaults to "Palash Soundarkar")
  9. Internal Signer Email (OPTIONAL — defaults to "palash@kabuni.com")
- COLLECTION RULES (critical — do not deviate):
  a. On the FIRST NDA turn, ask for ALL missing required fields (1–7) in ONE message as a single numbered list. Do NOT ask one-at-a-time.
  b. Parse the user's reply for ANY answers — they may reply in any order, batched, inline ("name: X, date: Y"), or as a numbered list. Extract every field you can find.
  c. Maintain an internal checklist. Each turn, restate what you have captured so far (numbered) and then ask ONLY for the still-missing fields in a single message. NEVER re-ask a field already answered.
  d. Fields 8 and 9 are OPTIONAL — apply the defaults silently. Do NOT ask for them unless the user volunteers them.
  e. If the user says "use defaults", "you decide", "skip", or expresses frustration about looping, fill any sensible defaults, summarise what you have, and ask only for the genuinely missing required fields.
  f. Once all required fields (1–7) are captured, show a one-block summary and ask a single yes/no confirmation, then call generate_nda. Never loop back to asking fields after confirmation.
- After generation, share the link using markdown: [Download NDA](download_url) using the actual URL from the tool result. The NDA is automatically dispatched for e-signature (internal signer first, then recipient) as part of generate_nda — explicitly state this in your reply (mention the internal signer by name) and DO NOT ask the user whether to send for e-signature. If the tool result has a non-null signature_error, surface that error and tell the user to retry via send_nda_for_signature.
- To view existing NDA submissions or check status, use list_nda_submissions.
- Use send_nda_for_signature manually only to RETRY a failed dispatch or re-send. Use dry_run=true to validate without sending.

**Release Logging (Auto-capture for /whats-new)**:
- Whenever the user describes shipping, fixing, improving, or releasing ANY user-facing change in conversation (e.g. "I just fixed X", "we shipped Y", "Z is now live"), IMMEDIATELY call log_release_change with the appropriate type and a clear one-line description. Do NOT ask for confirmation. Do NOT ask which release. Just log it.
- After logging, briefly mention you added it to the current draft release. Continue with whatever else the user asked.
- Only an admin can call this; if it fails with a permission error, mention that release logging requires admin and move on.
- Do NOT log internal refactors, code-only changes, or anything end-users wouldn't notice.

Always be aware that you are the central intelligence layer coordinating across all company tools and data.`;

const CALENDAR_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_calendar_events",
      description: "List upcoming calendar events. Use this when the user asks about their schedule, meetings, or calendar. Prefer the `window` shortcut (today/tomorrow/this_week/next_week) — it is resolved in the caller's timezone. Only pass timeMin/timeMax for custom ranges.",
      parameters: {
        type: "object",
        properties: {
          window: {
            type: "string",
            enum: ["today", "tomorrow", "this_week", "next_week"],
            description: "Convenience window resolved in the caller's local timezone. Overrides timeMin/timeMax when set.",
          },
          timeMin: {
            type: "string",
            description: "Start time in ISO 8601 format. Defaults to now. Ignored if `window` is set.",
          },
          timeMax: {
            type: "string",
            description: "End time in ISO 8601 format. If not specified, returns next 7 days. Ignored if `window` is set.",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of events to return. Default 10.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_calendar_event",
      description: "Create a new calendar event. Use this when the user wants to schedule a meeting or add an event.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Title of the event",
          },
          description: {
            type: "string",
            description: "Description or notes for the event",
          },
          startDateTime: {
            type: "string",
            description: "Start time in ISO 8601 format (e.g., 2024-01-15T10:00:00)",
          },
          endDateTime: {
            type: "string",
            description: "End time in ISO 8601 format",
          },
          location: {
            type: "string",
            description: "Location of the event",
          },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "List of attendee email addresses",
          },
        },
        required: ["summary", "startDateTime", "endDateTime"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_calendar_event",
      description: "Update an existing calendar event. Use this when the user wants to modify a meeting.",
      parameters: {
        type: "object",
        properties: {
          eventId: {
            type: "string",
            description: "The ID of the event to update",
          },
          summary: {
            type: "string",
            description: "New title of the event",
          },
          description: {
            type: "string",
            description: "New description for the event",
          },
          startDateTime: {
            type: "string",
            description: "New start time in ISO 8601 format",
          },
          endDateTime: {
            type: "string",
            description: "New end time in ISO 8601 format",
          },
          location: {
            type: "string",
            description: "New location of the event",
          },
        },
        required: ["eventId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_calendar_event",
      description: "Delete a calendar event. Use this when the user wants to cancel or remove a meeting.",
      parameters: {
        type: "object",
        properties: {
          eventId: {
            type: "string",
            description: "The ID of the event to delete",
          },
        },
        required: ["eventId"],
      },
    },
  },
];

const RESCHEDULE_TOOLS = [
  {
    type: "function",
    function: {
      name: "reschedule_event",
      description:
        "CANONICAL tool for moving/rescheduling/postponing any event (planner key event OR Google Calendar event). Use this for ALL date/time changes — 'move to tomorrow', 'reschedule', 'push by 1 hour', 'postpone'. Routing-aware: local Planner rows (calendar_id='local' or google_event_id starting with 'local:') are updated directly in the Planner; real Google events are PATCHed against Duncan's calendar identity. Every call performs post-write verification and returns {ok, verified, source, before, after, error}. NEVER claim a reschedule succeeded unless verified===true.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "key_events.id (UUID). Strongly preferred — call list_planner_events first." },
          google_event_id: { type: "string", description: "Google Calendar event ID (only when event_id is not available)." },
          calendar_id: { type: "string", description: "Calendar ID. 'local' for planner-only events; otherwise the Google calendar ID from list_planner_events." },
          startDateTime: { type: "string", description: "New start in ISO 8601 with timezone offset or UTC." },
          endDateTime: { type: "string", description: "New end in ISO 8601." },
          timeZone: { type: "string", description: "IANA timezone (e.g. 'Europe/London'). Defaults to event's existing start_tz." },
        },
        required: ["startDateTime", "endDateTime"],
      },
    },
  },
];

// KB_TOOLS: always-on Postgres+pgvector knowledge base search.
// MUST be the first thing the assistant tries for any informational query.
const KB_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description: "Semantic RAG search over the Kabuni Knowledge Base (documents uploaded via the Knowledge Base UI — handbooks, policies, brochures, playbooks, lists, reports, company docs). ALWAYS CALL THIS FIRST before any other search/retrieval tool whenever the user asks a question that could plausibly be answered by an uploaded document, references company knowledge, asks 'do we have…', 'what does X say about…', or names a file/policy/handbook/list/report. Returns ranked passages with the source document title. If this returns no relevant results, then (and only then) fall back to other sources (Google Drive, Azure Blob, web).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language query. Descriptive phrasing works best (semantic search)." },
          match_count: { type: "number", description: "Max chunks to return (default 8, max 25)." },
        },
        required: ["query"],
      },
    },
  },
];

// AZURE_DOC_TOOLS: Azure Blob storage browse/read — only when Azure is connected.
const AZURE_DOC_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_documents",
      description: "Search raw Azure Blob document storage by FILENAME (NDAs, generated reports, legacy folders). Prefer search_knowledge_base for anything uploaded via the Knowledge Base UI. Use this only when the user explicitly references a stored file by name or a non-KB folder.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query to find relevant documents by name. Be specific and include key terms.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_document",
      description: "Read the content of a specific document from storage. Use this after finding a document with search_documents to get its content.",
      parameters: {
        type: "object",
        properties: {
          blob_path: {
            type: "string",
            description: "The blob path of the file to read (from search_documents results).",
          },
        },
        required: ["blob_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_documents",
      description: "List documents in a specific folder path. Use this to browse folder contents.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The folder path to list (e.g. 'documents/', 'ndas/', 'templates/'). Defaults to root.",
          },
        },
        required: [],
      },
    },
  },
];

// Backwards-compat union. New code should prefer KB_TOOLS / AZURE_DOC_TOOLS.
const DOCUMENT_TOOLS = [...KB_TOOLS, ...AZURE_DOC_TOOLS];



const NDA_TOOLS = [
  {
    type: "function",
    function: {
      name: "generate_nda",
      description: "Generate an NDA document. Renders a Word .docx from the template, stores it in Azure Blob Storage, and returns a download link. Use when a user asks to create/generate an NDA.",
      parameters: {
        type: "object",
        properties: {
          receiving_party_name: { type: "string", description: "The receiving party name (used as folder name and doc title)" },
          receiving_party_entity: { type: "string", description: "Legal entity name of the receiving party" },
          date_of_agreement: { type: "string", description: "Date in YYYY-MM-DD format" },
          registered_address: { type: "string", description: "Registered address of the receiving party legal entity" },
          purpose: { type: "string", description: "Purpose of the NDA" },
          recipient_name: { type: "string", description: "Name of the person who will sign on behalf of the receiving party" },
          recipient_email: { type: "string", description: "Email of the recipient signer" },
          internal_signer_name: { type: "string", description: "Name of the internal Kabuni signer (defaults to Palash Soundarkar)" },
          internal_signer_email: { type: "string", description: "Email of the internal Kabuni signer (defaults to palash@kabuni.com)" },
        },
        required: ["receiving_party_name", "receiving_party_entity", "date_of_agreement", "registered_address", "purpose", "recipient_name", "recipient_email"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_nda_submissions",
      description: "List NDA submissions with optional status filter. Use to check status of NDAs or find ones pending signature.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status: draft, generated, sent, completed, failed, declined" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_nda_for_signature",
      description: "Send a generated NDA for e-signature via DocuSign. Requires admin role. Sends to Kabuni signer first, then recipient.",
      parameters: {
        type: "object",
        properties: {
          submission_id: { type: "string", description: "The NDA submission UUID to send for signing" },
          dry_run: { type: "boolean", description: "If true, validates everything but doesn't actually send the envelope" },
        },
        required: ["submission_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_pdf_for_signature",
      description: "Send an arbitrary PDF the user attached in chat to a single recipient for e-signature via DocuSign. Use this when the user attaches a PDF and asks to send it for esign / e-signature / DocuSign / signing. The attached PDF will be marked with `[E-SIGN READY]` along with a `staging_path` and `file_name` — pass those through unchanged. Before calling, you MUST have the recipient's full name AND a valid email; if either is missing, ASK the user (do not invent them). A signature, date, and full-name tab are auto-placed on page 1; the recipient receives a DocuSign email.",
      parameters: {
        type: "object",
        properties: {
          staging_path: { type: "string", description: "Exact `staging_path` value from the [E-SIGN READY] marker on the attached PDF." },
          file_name: { type: "string", description: "Exact `file_name` value from the [E-SIGN READY] marker." },
          recipient_name: { type: "string", description: "Full name of the person who will sign the PDF." },
          recipient_email: { type: "string", description: "Email address of the signer." },
          subject: { type: "string", description: "Optional email subject. Defaults to 'Please sign: <file_name>'." },
          message: { type: "string", description: "Optional email body / blurb to the signer." },
        },
        required: ["staging_path", "file_name", "recipient_name", "recipient_email"],
      },
    },
  },
];

const GOOGLE_FORMS_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_google_forms",
      description: "List all pre-configured Google Forms available for filling. Use this when the user wants to fill a form or asks what forms are available.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_google_form",
      description: "Submit a completed Google Form with all field values collected from the user. Only call this after you have gathered ALL required field values from the user through conversation.",
      parameters: {
        type: "object",
        properties: {
          form_id: { type: "string", description: "The UUID of the pre-configured form from list_google_forms" },
          entries: {
            type: "object",
            description: "Key-value pairs where keys are entry IDs (e.g. 'entry.123456') and values are the user's answers",
          },
        },
        required: ["form_id", "entries"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "parse_google_form",
      description: "Parse a Google Form URL to automatically extract its fields, entry IDs, and form action URL. Use this when a user provides a Google Form URL and wants to add it as a pre-configured form, or when an admin wants to set up a new form. After parsing, save the form to the database using save_parsed_google_form.",
      parameters: {
        type: "object",
        properties: {
          form_url: { type: "string", description: "The Google Form URL to parse (viewform URL)" },
        },
        required: ["form_url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_parsed_google_form",
      description: "Save a parsed Google Form to the database so it becomes available for filling. Use this after parse_google_form returns the form structure and the user confirms it looks correct.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Form title" },
          description: { type: "string", description: "Form description (optional)" },
          form_url: { type: "string", description: "The original form URL" },
          form_action_url: { type: "string", description: "The form action/submission URL" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                entry_id: { type: "string" },
                label: { type: "string" },
                type: { type: "string" },
                required: { type: "boolean" },
                options: { type: "array", items: { type: "string" } },
              },
            },
            description: "Array of field objects with entry_id, label, type, required, and optional options",
          },
        },
        required: ["title", "form_url", "form_action_url", "fields"],
      },
    },
  },
];


const MEETING_TOOLS = [
  {
    type: "function",
    function: {
      name: "fetch_plaud_meetings",
      description: "Sync new Plaud AI meeting recordings from Gmail into the meetings database. SLOW (~20s) — call ONLY when the user EXPLICITLY asks to sync/refresh/import Plaud data (keywords: 'sync Plaud', 'refresh Plaud', 'pull new Plaud', 'import from Plaud'). Do NOT call this for 'fetch my latest meeting notes', summarization, analysis, search, or general questions about existing meetings.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_meetings",
      description: "Lists ONLY meetings directly linked to the current user by verified host/email/participant data. Do NOT use for source-ambiguous requests like 'fetch my latest meeting notes' unless the user explicitly asks for meetings they attended/hosted/are linked to. Use scope='all' only when explicitly requested.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status: pending, transcribed, audio_only, analyzed" },
          limit: { type: "number", description: "Max results (default 20)" },
          search: { type: "string", description: "Keyword(s) to match in title or transcript. Words are matched independently (OR), so partial / misspelled queries still work." },
          from_date: { type: "string", description: "Only return meetings on or after this date (YYYY-MM-DD). Ignored if 'window' is set." },
          to_date: { type: "string", description: "Only return meetings on or before this date (YYYY-MM-DD). Ignored if 'window' is set." },
          window: { type: "string", enum: ["today", "tomorrow", "this_week", "next_week", "last_week", "this_month", "last_month"], description: "Resolve a date window in the caller's timezone. ALWAYS prefer this over from_date/to_date for natural-language ranges like 'this week', 'last week', 'last month'. Do NOT compute dates yourself when a window value exists." },
          scope: { type: "string", enum: ["mine", "all"], description: "'mine' (default) returns only the current user's meetings. 'all' requires admin and returns the full company list — use ONLY when the user explicitly asks for everyone's meetings." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_meeting",
      description: "Get full details of a specific meeting including transcript, analysis, action items, and participants. Use this after listing meetings to dive into a specific one.",
      parameters: {
        type: "object",
        properties: {
          meeting_id: { type: "string", description: "The meeting UUID" },
        },
        required: ["meeting_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_meeting_action_items_with_context",
      description: "Return the action items for a specific meeting AND aggregate the action items from every other meeting in the days_back window ending at that meeting's date (default 7 days). Use this whenever the user asks for action items, tasks, follow-ups, or to-dos from a named meeting — the response includes the focus meeting plus weekly rollup so Duncan can present both sections. meeting_id MUST come from a prior list_meetings / list_meetings_by_source call in this turn.",
      parameters: {
        type: "object",
        properties: {
          meeting_id: { type: "string", description: "The meeting UUID returned by list_meetings or list_meetings_by_source." },
          days_back: { type: "number", description: "Days before the meeting to include in the rollup (default 7, min 1, max 30)." },
        },
        required: ["meeting_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_action_items_for_range",
      description: "Aggregate action items across EVERY meeting the caller can see within a date range. Use this for queries like 'what are my action items this week', 'action items from last week', 'tasks from last month's meetings', or anytime the user wants follow-ups across a period rather than a single meeting. Prefer the `window` shortcut over manual dates. Returns one combined list plus per-meeting breakdown.",
      parameters: {
        type: "object",
        properties: {
          window: { type: "string", enum: ["today", "this_week", "next_week", "last_week", "this_month", "last_month"], description: "Resolve a date window in the caller's timezone. ALWAYS prefer this over from_date/to_date for natural-language ranges." },
          from_date: { type: "string", description: "YYYY-MM-DD inclusive lower bound. Ignored if `window` is set." },
          to_date: { type: "string", description: "YYYY-MM-DD inclusive upper bound. Ignored if `window` is set." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_meetings",
      description: "Run AI analysis on meetings that have transcripts but haven't been analyzed yet. Can also re-analyze specific meetings. Extracts summary, action items, decisions, participants, sentiment, risks, and follow-ups.",
      parameters: {
        type: "object",
        properties: {
          meeting_id: { type: "string", description: "Specific meeting ID to analyze (optional — omit to auto-analyze all pending)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_meetings_by_source",
      description: "FALLBACK ONLY. Lists recent meetings by ingestion source (gemini or plaud), regardless of ownership. Use ONLY after list_meetings(scope='mine') returned empty AND the user has confirmed they want to see source-based results, OR the user explicitly asks for 'gemini notes' / 'Google Meet notes' / 'plaud recordings'. For latest meeting notes, use limit=1 and return the notes directly without asking summary/full/paste/doc follow-ups. Results are NOT the user's meetings — they are unattributed company-wide notes from that source. Always disclose this clearly to the user.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["gemini", "plaud"], description: "Which ingestion source to pull from." },
          limit: { type: "number", description: "Max results (default 10, max 25)." },
          from_date: { type: "string", description: "YYYY-MM-DD lower bound on meeting_date. Ignored if 'window' is set." },
          to_date: { type: "string", description: "YYYY-MM-DD upper bound on meeting_date. Ignored if 'window' is set." },
          window: { type: "string", enum: ["today", "tomorrow", "this_week", "next_week", "last_week", "this_month", "last_month"], description: "Resolve a date window in the caller's timezone instead of supplying from_date/to_date." },
        },
        required: ["source"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_meeting_transcripts",
      description: "Search across all meeting transcripts to find discussions about a specific topic. Use this when the user asks 'What did we discuss about X?' or 'When did we talk about Y?'",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The topic or keyword to search for across meeting transcripts" },
        },
        required: ["query"],
      },
    },
  },
];

const AZURE_DEVOPS_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_azure_devops_projects",
      description: "List all projects in Azure DevOps. Use this to discover available projects before querying work items.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "query_azure_work_items",
      description: "Query Azure DevOps work items using WIQL (Work Item Query Language) for real-time data from Azure DevOps API. Use for complex or live queries. Example WIQL: SELECT [System.Id], [System.Title], [System.State] FROM workitems WHERE [System.State] = 'Active' AND [System.AssignedTo] = 'John' ORDER BY [System.ChangedDate] DESC",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project name to query within (optional, queries across all if omitted)" },
          wiql: { type: "string", description: "WIQL query string" },
        },
        required: ["wiql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_azure_work_item",
      description: "Get full details of a specific Azure DevOps work item by its ID.",
      parameters: {
        type: "object",
        properties: {
          work_item_id: { type: "number", description: "The work item ID (external_id)" },
        },
        required: ["work_item_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_synced_work_items",
      description: "Search previously synced Azure DevOps work items from the local database. Faster than live queries. Supports filtering by state, type, assignee, project, and text search in title/tags.",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", description: "Filter by state: New, Active, Resolved, Closed, Removed" },
          work_item_type: { type: "string", description: "Filter by type: Bug, Task, User Story, Feature, Epic, etc." },
          assigned_to: { type: "string", description: "Filter by assignee name (partial match)" },
          project_name: { type: "string", description: "Filter by project name" },
          search: { type: "string", description: "Search in title and tags" },
          limit: { type: "number", description: "Max results (default 25)" },
        },
        required: [],
      },
    },
  },
];

const AZURE_REPOS_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_azure_repos",
      description: "List all Azure DevOps Git repositories across every project. Returns repo name, project, default branch, and size. Use to discover available repos before querying commits or PRs.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_commits",
      description: "Fetch recent commits across Azure Repos. Use for team activity, who shipped what, or briefings. Defaults to last 7 days across all repos. Optionally scope to a specific repo or author.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Lookback window in days (1-90, default 7)" },
          top: { type: "number", description: "Max commits per repo (1-200, default 50)" },
          project: { type: "string", description: "Optional: project name to scope to" },
          repository_id: { type: "string", description: "Optional: repository GUID to scope to (requires project)" },
          author: { type: "string", description: "Optional: filter by author name or email" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pull_requests",
      description: "List pull requests across Azure Repos. Defaults to active (open) PRs org-wide. Returns title, status, author, source/target branches, reviewers, and votes (10=approved, 5=approved with suggestions, 0=no vote, -5=waiting, -10=rejected).",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "active | completed | abandoned | all (default active)" },
          top: { type: "number", description: "Max PRs (1-200, default 50)" },
          project: { type: "string", description: "Optional: scope to a project" },
          repository_id: { type: "string", description: "Optional: scope to a repo (requires project)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pr_reviews",
      description: "Get review threads and comments for a specific pull request. Use to understand review velocity, blockers, or what reviewers said.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project name" },
          repository_id: { type: "string", description: "Repository GUID" },
          pull_request_id: { type: "number", description: "Pull request ID" },
        },
        required: ["project", "repository_id", "pull_request_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_repos_team_summary",
      description: "Aggregated engineering activity summary for the Team Briefing: total commits, commits per author, commits per repo, recent commits list, and active PRs. Defaults to 7-day window.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Lookback window in days (1-30, default 7)" },
        },
        required: [],
      },
    },
  },
];

const HUBSPOT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_hubspot_pipeline_summary",
      description: "Get the full HubSpot CRM commercial snapshot: active deals (with stages, amounts, owners), at-risk / stale accounts, key contacts, lifecycle stages, lists, and marketing form metrics (newsletter & scout signups with 30-day windows and location breakdown). Use for any question about the sales pipeline, deal health, active accounts, CRM activity, or marketing signups. This is the single source of truth for HubSpot data — call it once and reason over the result.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_hubspot",
      description: "Search HubSpot for a specific contact, company, or deal by name, email, or domain. Use when the user names a specific person, organisation, or deal (e.g. 'do we have Acme in HubSpot?', 'find John Smith', 'what's the status of the Globex deal?'). Returns up to 25 matches per object type.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term: name, email, domain, or deal name" },
          objects: {
            type: "array",
            items: { type: "string", enum: ["contacts", "companies", "deals"] },
            description: "Which HubSpot object types to search. Defaults to all three if omitted.",
          },
          limit: { type: "number", description: "Max results per object type (1-25, default 10)" },
        },
        required: ["query"],
      },
    },
  },
];



const XERO_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_xero_invoices",
      description: "List invoices from Xero (synced to local database). Supports filtering by status, type, and search by invoice number or contact name. Use when the user asks about invoices, bills, or payments.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status: AUTHORISED, PAID, DRAFT, VOIDED, DELETED, SUBMITTED" },
          type: { type: "string", description: "Filter by type: ACCPAY (bills to pay) or ACCREC (receivable invoices)" },
          search: { type: "string", description: "Search by invoice number or contact name" },
          limit: { type: "number", description: "Max results (default 25)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_xero_invoice",
      description: "Get full details of a specific Xero invoice including line items. Use after listing invoices to dive into a specific one.",
      parameters: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "The invoice UUID (internal database ID)" },
        },
        required: ["invoice_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_xero_invoice_payment",
      description: "Approve payment for an AUTHORISED Xero bill (ACCPAY) under £300 only. Invoices of £300 or more cannot be approved through Duncan. Only Patrick Badenoch can use this tool. Requires explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "The invoice UUID (internal database ID)" },
          confirmed: { type: "boolean", description: "Whether the user has explicitly confirmed payment approval. Must be true to proceed." },
        },
        required: ["invoice_id", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_xero_contacts",
      description: "Search Xero contacts by name. Use this to find the correct contact before creating an invoice.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Contact name to search for (partial match)" },
        },
        required: ["search"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_xero_invoice",
      description: "Submit a new invoice to Xero. Can create both bills (ACCPAY — money owed to suppliers) and sales invoices (ACCREC — money owed by customers). Collect all details conversationally before calling. Requires explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["ACCPAY", "ACCREC"], description: "ACCPAY for bills (supplier invoices), ACCREC for sales invoices (customer invoices)" },
          contact_name: { type: "string", description: "Exact name of the Xero contact (use search_xero_contacts to find)" },
          contact_id: { type: "string", description: "The Xero external contact ID (from search_xero_contacts)" },
          date: { type: "string", description: "Invoice date in YYYY-MM-DD format" },
          due_date: { type: "string", description: "Payment due date in YYYY-MM-DD format" },
          reference: { type: "string", description: "Invoice reference number or description" },
          line_items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string", description: "Line item description" },
                quantity: { type: "number", description: "Quantity (default 1)" },
                unit_amount: { type: "number", description: "Unit price / amount" },
                account_code: { type: "string", description: "Xero account code (e.g. '200' for Sales, '400' for Advertising, '310' for Insurance, '300' for Rent). Ask user if unsure." },
                tax_type: { type: "string", description: "Tax type (e.g. 'OUTPUT2' for 20% VAT, 'NONE' for no tax, 'INPUT2' for input VAT)" },
              },
              required: ["description", "unit_amount"],
            },
            description: "Array of line items for the invoice",
          },
          status: { type: "string", enum: ["DRAFT", "SUBMITTED", "AUTHORISED"], description: "Invoice status. Default DRAFT for safety. Use SUBMITTED or AUTHORISED only if user explicitly requests." },
          currency_code: { type: "string", description: "Currency code (default GBP)" },
          confirmed: { type: "boolean", description: "Whether the user has explicitly confirmed the invoice details. Must be true to proceed." },
        },
        required: ["type", "contact_name", "contact_id", "line_items", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_xero_bank_accounts",
      description: "List bank accounts configured in Xero. Use this to find the correct bank account (AccountID) before recording an expense.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "create_xero_expense",
      description: "Record an expense (Spend Money / Bank Transaction) in Xero. This creates a SPEND bank transaction against a specific bank account. Use when the user says they want to log/record an expense, add a spend, or record a payment that's already been made. Collect: contact, bank account, line items (description, amount, account code), date, and reference. Requires explicit user confirmation.",
      parameters: {
        type: "object",
        properties: {
          contact_name: { type: "string", description: "Name of the payee/supplier (use search_xero_contacts to find)" },
          contact_id: { type: "string", description: "The Xero external contact ID (from search_xero_contacts)" },
          bank_account_id: { type: "string", description: "The Xero bank account ID to debit (from list_xero_bank_accounts)" },
          date: { type: "string", description: "Transaction date in YYYY-MM-DD format" },
          reference: { type: "string", description: "Reference or description for the expense" },
          line_items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string", description: "Expense description" },
                quantity: { type: "number", description: "Quantity (default 1)" },
                unit_amount: { type: "number", description: "Amount" },
                account_code: { type: "string", description: "Xero expense account code (e.g. '429' General Expenses, '400' Advertising, '404' Cleaning, '461' Printing, '310' Insurance, '493' Travel)" },
                tax_type: { type: "string", description: "Tax type (e.g. 'INPUT2' for 20% VAT, 'NONE' for no tax)" },
              },
              required: ["description", "unit_amount"],
            },
            description: "Array of expense line items",
          },
          currency_code: { type: "string", description: "Currency code (default GBP)" },
          confirmed: { type: "boolean", description: "Whether the user has explicitly confirmed. Must be true to proceed." },
        },
        required: ["contact_name", "contact_id", "bank_account_id", "line_items", "confirmed"],
      },
    },
  },
];

const GMAIL_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_gmail_emails",
      description: "List recent emails from the user's Gmail inbox. Use when the user asks about their emails, inbox, or recent messages.",
      parameters: {
        type: "object",
        properties: {
          maxResults: { type: "number", description: "Number of emails to return (default 15, max 25)" },
          window: { type: "string", enum: ["today", "tomorrow", "this_week", "next_week"], description: "Restrict to emails received in this window, resolved in the caller's timezone. Adds Gmail after:/before: filters automatically." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_gmail",
      description: "Search the user's Gmail using a query string. Supports Gmail search syntax like 'from:john subject:invoice after:2026/01/01'. Use when the user wants to find specific emails.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query (e.g., 'from:john@example.com', 'subject:invoice', 'has:attachment', 'after:2026/01/01')" },
          maxResults: { type: "number", description: "Max results (default 15)" },
          window: { type: "string", enum: ["today", "tomorrow", "this_week", "next_week"], description: "Restrict to messages received in this window (caller's timezone). If set, after:/before: are appended to your query — do not include them yourself." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_gmail_email",
      description: "Read the full content of a specific email by its message ID. Use after listing or searching emails to get the full body of a message.",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "The Gmail message ID to read" },
        },
        required: ["messageId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_gmail_email",
      description: "Send an email from the user's Gmail account. The body MUST follow the email composition rules: greeting, clear opening, concise body (max 2-3 paragraphs), closing with next step, and sign-off with sender name. Always confirm the draft with the user before sending. Requires explicit confirmation.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          cc: { type: "string", description: "CC email addresses (comma-separated)" },
          bcc: { type: "string", description: "BCC email addresses (comma-separated)" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body (can include HTML formatting)" },
          confirmed: { type: "boolean", description: "Whether the user has explicitly confirmed sending. Must be true to proceed." },
        },
        required: ["to", "subject", "body", "confirmed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_gmail_thread",
      description: "Read a full Gmail thread (conversation) by threadId. Returns the last 5 messages in chronological order. ALWAYS call this before draft_gmail_reply so you have full context of the conversation, including the original message and any prior replies.",
      parameters: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "The Gmail thread ID (returned by list/search/read)." },
        },
        required: ["threadId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_gmail_reply",
      description: "Draft a reply to an existing Gmail thread. The draft is saved to the user's Gmail Drafts folder — IT IS NEVER SENT. The user reviews/edits/sends it themselves in Gmail. Returns a draftUrl. Always call read_gmail_thread first to understand context. The body MUST follow the user's writing style (provided in system prompt) AND email composition rules.",
      parameters: {
        type: "object",
        properties: {
          threadId: { type: "string", description: "Thread ID to reply within." },
          messageId: { type: "string", description: "Message-ID header of the message being replied to (from read_gmail_thread.messageIdHeader)." },
          to: { type: "string", description: "Recipient email — usually the From of the message being replied to." },
          cc: { type: "string", description: "CC addresses (comma-separated). Optional." },
          bcc: { type: "string", description: "BCC addresses (comma-separated). Optional." },
          subject: { type: "string", description: "Subject — typically 'Re: <original subject>'." },
          body: { type: "string", description: "Reply body. Mimic the user's writing style." },
          references: { type: "string", description: "References header value, optional, for proper threading." },
        },
        required: ["threadId", "to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_gmail_email",
      description: "Create a new email draft (not a reply). Saved to the user's Gmail Drafts folder — NEVER auto-sent. The user reviews and sends it themselves. Returns a draftUrl. Body MUST follow user's writing style (provided in system prompt) AND email composition rules.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email." },
          cc: { type: "string", description: "CC addresses (comma-separated). Optional." },
          bcc: { type: "string", description: "BCC addresses (comma-separated). Optional." },
          subject: { type: "string", description: "Subject line." },
          body: { type: "string", description: "Draft body." },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
];

const GOOGLE_DRIVE_TOOLS = [
  {
    type: "function",
    function: {
      name: "drive_list_files",
      description: "List files and folders inside a Google Drive folder. Use when the user asks to browse or list files in Drive. Pass folderId to list a specific folder's contents, or omit for root.",
      parameters: {
        type: "object",
        properties: {
          folderId: { type: "string", description: "The Google Drive folder ID to list. Omit for root." },
          query: { type: "string", description: "Optional search query to filter by file name." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "drive_search",
      description: "Search Google Drive for files or folders by exact name and/or MIME type. Use to find specific folders like 'Weekly Reports' or files by name. For folders, use mimeType 'application/vnd.google-apps.folder'.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exact name of the file or folder to find." },
          mimeType: { type: "string", description: "MIME type filter (e.g., 'application/vnd.google-apps.folder' for folders)." },
          parentId: { type: "string", description: "Optional parent folder ID to scope the search." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "drive_get_content",
      description: "Read the text content of a file from Google Drive. For Google Docs, exports as plain text. For Google Sheets, exports as CSV. For other text files, downloads content. Use after finding a file with drive_list_files or drive_search.",
      parameters: {
        type: "object",
        properties: {
          fileId: { type: "string", description: "The Google Drive file ID." },
          mimeType: { type: "string", description: "The MIME type of the file (from the listing result)." },
        },
        required: ["fileId", "mimeType"],
      },
    },
  },
];

const SLACK_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_slack_channels",
      description: "List Slack channels visible to the connected user. Use when the user asks what Slack channels are available or wants to find a channel.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_slack_channel_messages",
      description: "Read recent messages from a Slack channel by channel ID. Use after list_slack_channels or when a channel ID is known.",
      parameters: {
        type: "object",
        properties: {
          channel_id: { type: "string", description: "Slack channel ID, e.g. C123 or G123." },
          limit: { type: "number", description: "Maximum messages to return. Default 20, max 50." },
        },
        required: ["channel_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_slack_message",
      description: "Send a Slack message to a channel by channel ID. Ask for confirmation before sending unless the user explicitly says to send now.",
      parameters: {
        type: "object",
        properties: {
          channel_id: { type: "string", description: "Slack channel ID." },
          text: { type: "string", description: "Message text to send." },
        },
        required: ["channel_id", "text"],
      },
    },
  },
];

const RELEASE_TOOLS = [
  {
    type: "function",
    function: {
      name: "log_release_change",
      description: "Append a user-facing change to the current rolling DRAFT release on /whats-new. Call this PROACTIVELY (without asking) whenever the user mentions they shipped a feature, fixed a bug, made an improvement, or completed any change end-users will notice. If no draft release exists, one is auto-created with an auto-incremented version. Do NOT ask for confirmation — just log it. Briefly confirm to the user it was added.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["feature", "improvement", "fix", "other"], description: "Category of the change" },
          description: { type: "string", description: "One-line user-facing description of the change. Plain English, present tense (e.g. 'Gmail auto-drafts now scan the last 7 days of inbox')." },
          version_bump: { type: "string", enum: ["patch", "minor", "major"], description: "Optional. How to bump the version when creating a new draft (defaults to patch)." },
        },
        required: ["type", "description"],
      },
    },
  },
];

function bumpVersion(version: string, kind: "patch" | "minor" | "major" = "patch"): string {
  const parts = version.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10));
  while (parts.length < 3) parts.push(0);
  let [maj, min, pat] = parts.map((n) => (isNaN(n) ? 0 : n));
  if (kind === "major") { maj += 1; min = 0; pat = 0; }
  else if (kind === "minor") { min += 1; pat = 0; }
  else { pat += 1; }
  return `${maj}.${min}.${pat}`;
}

async function executeReleaseTool(
  toolName: string,
  args: any,
  supabaseAdmin: any,
  userId: string,
): Promise<any> {
  if (toolName !== "log_release_change") return { error: "Unknown release tool" };
  if (!userId) return { error: "Authentication required" };

  // Admin check
  const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (!isAdmin) return { error: "Release logging requires admin permission" };

  const { type, description, version_bump } = args || {};
  if (!type || !description) return { error: "type and description are required" };

  // Find current draft
  const { data: drafts } = await supabaseAdmin
    .from("releases")
    .select("*")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1);

  let release = drafts && drafts[0];

  if (!release) {
    // Determine next version from latest published
    const { data: latestPub } = await supabaseAdmin
      .from("releases")
      .select("version")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(1);
    const baseVersion = latestPub?.[0]?.version || "0.0.0";
    const newVersion = bumpVersion(baseVersion, (version_bump as any) || "patch");

    const { data: created, error: createErr } = await supabaseAdmin
      .from("releases")
      .insert({
        version: newVersion,
        title: "Draft",
        summary: "",
        changes: [],
        status: "draft",
        created_by: userId,
      })
      .select()
      .single();
    if (createErr) return { error: `Failed to create draft: ${createErr.message}` };
    release = created;
  }

  const existingChanges = Array.isArray(release.changes) ? release.changes : [];
  const updatedChanges = [...existingChanges, { type, description }];

  const { error: updErr } = await supabaseAdmin
    .from("releases")
    .update({ changes: updatedChanges })
    .eq("id", release.id);
  if (updErr) return { error: `Failed to append change: ${updErr.message}` };

  return {
    success: true,
    release_id: release.id,
    version: release.version,
    total_changes: updatedChanges.length,
    message: `Added to draft release v${release.version} (${updatedChanges.length} change${updatedChanges.length === 1 ? "" : "s"} pending publication).`,
  };
}

const LOVABLE_CONTRIBUTORS_TOOLS = [
  {
    type: "function",
    function: {
      name: "update_lovable_contributors",
      description: "Parse an attached screenshot of the Lovable Project Settings → People page and store the per-member usage rows as a new dated snapshot. Use this ONLY when the user has attached an image AND asks to refresh / update / import the Lovable contributors leaderboard for the Team Briefing. Admin-only. Reads the image directly from the latest user message — do NOT pass the image as an argument.",
      parameters: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            description: "Parsed rows extracted from the screenshot. One entry per visible person.",
            items: {
              type: "object",
              properties: {
                member_name: { type: "string", description: "Person's full name as shown in the People list" },
                role: { type: "string", description: "Role label, e.g. 'Owner', 'Admin', 'Collaborator'. Empty string if not visible." },
                period_credits: { type: "number", description: "The 'Apr usage' (or current period usage) credit count for this person. Integer." },
                period_label: { type: "string", description: "Header label of the period column, e.g. 'Apr usage'." },
                total_credits: { type: "number", description: "The 'Total usage' credit count for this person. Integer." },
                credit_limit: { type: "number", description: "The 'Credit limit' for this person if shown, otherwise omit." },
              },
              required: ["member_name", "period_credits", "total_credits"],
            },
          },
        },
        required: ["rows"],
      },
    },
  },
];

async function executeLovableContributorsTool(
  toolName: string,
  args: any,
  supabaseAdmin: any,
  userId: string,
): Promise<any> {
  if (toolName !== "update_lovable_contributors") return { error: "Unknown tool" };
  if (!userId) return { error: "Authentication required" };

  const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (!isAdmin) return { error: "Updating Lovable contributors requires admin permission." };

  const rawRows = Array.isArray(args?.rows) ? args.rows : [];
  const cleaned = rawRows
    .map((r: any) => ({
      member_name: typeof r?.member_name === "string" ? r.member_name.trim() : "",
      role: typeof r?.role === "string" ? r.role.trim() : null,
      period_credits: Number.isFinite(Number(r?.period_credits)) ? Math.round(Number(r.period_credits)) : null,
      period_label: typeof r?.period_label === "string" ? r.period_label.trim() : null,
      total_credits: Number.isFinite(Number(r?.total_credits)) ? Math.round(Number(r.total_credits)) : 0,
      credit_limit: Number.isFinite(Number(r?.credit_limit)) ? Math.round(Number(r.credit_limit)) : null,
    }))
    .filter((r: any) => r.member_name.length > 0 && r.period_credits !== null);

  if (cleaned.length === 0) {
    return { error: "No valid rows could be parsed from the screenshot. Each row needs a name and a period usage number." };
  }

  const today = new Date().toISOString().slice(0, 10);
  const insertRows = cleaned.map((r: any) => ({
    snapshot_date: today,
    member_name: r.member_name,
    role: r.role,
    period_credits: r.period_credits,
    period_label: r.period_label,
    total_credits: r.total_credits,
    credit_limit: r.credit_limit,
    created_by: userId,
  }));

  const { error: insErr } = await supabaseAdmin
    .from("lovable_usage_snapshots")
    .insert(insertRows);
  if (insErr) return { error: `Failed to save snapshot: ${insErr.message}` };

  return {
    success: true,
    snapshot_date: today,
    row_count: cleaned.length,
    message: `Saved ${cleaned.length} Lovable contributor${cleaned.length === 1 ? "" : "s"} as of ${today}. Visible now in Team Briefing → Section 07.`,
  };
}

const EXEC_SUMMARY_TOOLS = [
  {
    type: "function",
    function: {
      name: "generate_exec_summary_document",
      description: "Generate a downloadable executive summary document (styled HTML that can be printed as PDF). Use this AFTER you have already fetched and synthesized the weekly report content from Google Drive. Pass the full synthesized summary as the 'content' parameter. The document will be uploaded to storage and a download link returned.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title, e.g. 'Executive Summary — Week of 6th-10th April 2025'" },
          week_range: { type: "string", description: "The week range, e.g. '6th - 10th April 2025'" },
          content: { type: "string", description: "The full executive summary content in markdown format. Include all sections, KPIs, RYG statuses, and action items." },
        },
        required: ["title", "content"],
      },
    },
  },
];

const ANALYTICS_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_workstream_analytics",
      description: "Get analytics for workstream cards and tasks. Returns card counts by status (red/amber/green/done), overdue tasks, task completion rates, and assignee workload. Use when users ask about project health, team workload, workstream status, or card/task metrics.",
      parameters: {
        type: "object",
        properties: {
          project_tag: { type: "string", description: "Filter by project tag (e.g. 'Lightning Strike Event', 'Website', 'K10 App', 'School Integrations')" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recruitment_analytics",
      description: "Get recruitment pipeline analytics. Returns candidate counts by status, average scores, job role breakdown, and Hireflix interview stats. Use when users ask about hiring pipeline, recruitment progress, or candidate metrics.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_team_activity_analytics",
      description: "Get recent team activity across workstreams. Returns activity log, most active users, recent comments, and card creation trends. Use when users ask about team activity, who's been active, or recent changes.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Number of days to look back (default 7)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_operational_summary",
      description: "Get a comprehensive operational summary across all systems: workstream health, open POs, recruitment pipeline, recent meetings, outstanding issues, and overdue items. Use when users ask for an overview, dashboard, or operational status report.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_google_analytics_dashboard",
      description: "Get connected GA4 website analytics for the current user. Returns summary metrics, top pages, geography, devices, demographics availability, and traffic sources. Use when users ask about Google Analytics, website traffic, users, sessions, engagement, top pages, audience, acquisition, countries, cities, devices, or sources.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

async function executeAnalyticsTool(
  toolName: string,
  args: any,
  supabaseAdmin: any,
  supabaseUrl?: string,
  authHeader?: string
): Promise<any> {
  switch (toolName) {
    case "get_workstream_analytics": {
      // Cards by status
      let cardsQuery = supabaseAdmin
        .from("workstream_cards")
        .select("id, title, status, project_tag, due_date, created_at, archived_at, owner_id")
        .is("archived_at", null);
      if (args.project_tag) cardsQuery = cardsQuery.eq("project_tag", args.project_tag);
      const { data: cards, error: cardsErr } = await cardsQuery;
      if (cardsErr) throw new Error(`Failed to fetch cards: ${cardsErr.message}`);

      const statusCounts: Record<string, number> = { red: 0, amber: 0, green: 0, done: 0 };
      for (const c of cards || []) {
        statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
      }

      // Tasks
      const cardIds = (cards || []).map((c: any) => c.id);
      let taskData: any[] = [];
      if (cardIds.length > 0) {
        const { data: tasks } = await supabaseAdmin
          .from("workstream_tasks")
          .select("id, completed, due_date, card_id")
          .in("card_id", cardIds);
        taskData = tasks || [];
      }

      const totalTasks = taskData.length;
      const completedTasks = taskData.filter((t: any) => t.completed).length;
      const now = new Date().toISOString();
      const overdueTasks = taskData.filter((t: any) => !t.completed && t.due_date && t.due_date < now).length;

      // Assignee workload
      let assigneeData: any[] = [];
      if (cardIds.length > 0) {
        const { data: assignees } = await supabaseAdmin
          .from("workstream_card_assignees")
          .select("user_id, card_id")
          .in("card_id", cardIds);
        assigneeData = assignees || [];
      }

      const workload: Record<string, number> = {};
      for (const a of assigneeData) {
        workload[a.user_id] = (workload[a.user_id] || 0) + 1;
      }

      // Get display names for assignees
      const userIds = Object.keys(workload);
      let userNames: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", userIds);
        for (const p of profiles || []) {
          userNames[p.user_id] = p.display_name || "Unknown";
        }
      }

      return {
        total_cards: (cards || []).length,
        cards_by_status: statusCounts,
        tasks: { total: totalTasks, completed: completedTasks, overdue: overdueTasks, completion_rate: totalTasks > 0 ? `${Math.round((completedTasks / totalTasks) * 100)}%` : "N/A" },
        assignee_workload: Object.entries(workload).map(([uid, count]) => ({ name: userNames[uid] || uid, cards_assigned: count })),
        filter: args.project_tag || "All projects",
      };
    }

    case "get_recruitment_analytics": {
      const { data: candidates } = await supabaseAdmin
        .from("candidates")
        .select("id, status, competency_score, values_score, total_score, job_role_id, hireflix_status");

      const { data: jobRoles } = await supabaseAdmin
        .from("job_roles")
        .select("id, title, status");

      const statusCounts: Record<string, number> = {};
      let totalScore = 0, scoredCount = 0;
      const hireflixCounts: Record<string, number> = {};
      const roleBreakdown: Record<string, number> = {};

      for (const c of candidates || []) {
        statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
        if (c.total_score) { totalScore += Number(c.total_score); scoredCount++; }
        if (c.hireflix_status) { hireflixCounts[c.hireflix_status] = (hireflixCounts[c.hireflix_status] || 0) + 1; }
        if (c.job_role_id) { roleBreakdown[c.job_role_id] = (roleBreakdown[c.job_role_id] || 0) + 1; }
      }

      const roleMap: Record<string, string> = {};
      for (const r of jobRoles || []) { roleMap[r.id] = r.title; }

      return {
        total_candidates: (candidates || []).length,
        candidates_by_status: statusCounts,
        average_score: scoredCount > 0 ? (totalScore / scoredCount).toFixed(1) : "N/A",
        hireflix_interviews: hireflixCounts,
        active_job_roles: (jobRoles || []).filter((r: any) => r.status === "active").length,
        total_job_roles: (jobRoles || []).length,
        candidates_per_role: Object.entries(roleBreakdown).map(([roleId, count]) => ({ role: roleMap[roleId] || roleId, candidates: count })),
      };
    }

    case "get_team_activity_analytics": {
      const days = args.days || 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const { data: activity } = await supabaseAdmin
        .from("workstream_activity")
        .select("id, action, user_id, card_id, created_at, details")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);

      const { data: comments } = await supabaseAdmin
        .from("workstream_comments")
        .select("id, user_id, card_id, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20);

      // User activity counts
      const userActivity: Record<string, number> = {};
      for (const a of activity || []) {
        userActivity[a.user_id] = (userActivity[a.user_id] || 0) + 1;
      }

      // Get names
      const userIds = [...new Set([...Object.keys(userActivity), ...(comments || []).map((c: any) => c.user_id)])];
      let userNames: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", userIds);
        for (const p of profiles || []) {
          userNames[p.user_id] = p.display_name || "Unknown";
        }
      }

      // Action breakdown
      const actionCounts: Record<string, number> = {};
      for (const a of activity || []) {
        actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;
      }

      return {
        period: `Last ${days} days`,
        total_activities: (activity || []).length,
        total_comments: (comments || []).length,
        action_breakdown: actionCounts,
        most_active_users: Object.entries(userActivity)
          .sort(([, a], [, b]) => (b as number) - (a as number))
          .slice(0, 10)
          .map(([uid, count]) => ({ name: userNames[uid] || uid, actions: count })),
        recent_activity: (activity || []).slice(0, 10).map((a: any) => ({
          action: a.action,
          user: userNames[a.user_id] || a.user_id,
          time: a.created_at,
        })),
      };
    }

    case "get_operational_summary": {
      // Workstream cards
      const { data: cards } = await supabaseAdmin
        .from("workstream_cards")
        .select("id, status, project_tag")
        .is("archived_at", null);

      const cardStatus: Record<string, number> = {};
      for (const c of cards || []) { cardStatus[c.status] = (cardStatus[c.status] || 0) + 1; }

      // Purchase orders
      const { data: pos } = await supabaseAdmin
        .from("purchase_orders")
        .select("id, status, total_amount")
        .in("status", ["draft", "pending_approval"]);

      // Candidates
      const { data: candidates } = await supabaseAdmin
        .from("candidates")
        .select("id, status")
        .in("status", ["pending", "shortlisted", "interview"]);

      const candidateStatus: Record<string, number> = {};
      for (const c of candidates || []) { candidateStatus[c.status] = (candidateStatus[c.status] || 0) + 1; }

      // Recent meetings
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: meetings } = await supabaseAdmin
        .from("meetings")
        .select("id, title, status")
        .gte("created_at", weekAgo);

      // Open issues
      const { data: issues } = await supabaseAdmin
        .from("issues")
        .select("id, severity")
        .order("created_at", { ascending: false })
        .limit(50);

      const issueSeverity: Record<string, number> = {};
      for (const i of issues || []) { issueSeverity[i.severity] = (issueSeverity[i.severity] || 0) + 1; }

      // Overdue tasks
      const now = new Date().toISOString();
      const { data: overdueTasks } = await supabaseAdmin
        .from("workstream_tasks")
        .select("id, title, due_date")
        .eq("completed", false)
        .lt("due_date", now)
        .not("due_date", "is", null)
        .limit(20);

      return {
        workstream: {
          total_active_cards: (cards || []).length,
          by_status: cardStatus,
          overdue_tasks: (overdueTasks || []).length,
          overdue_task_list: (overdueTasks || []).slice(0, 5).map((t: any) => ({ title: t.title, due: t.due_date })),
        },
        purchase_orders: {
          pending_count: (pos || []).length,
          pending_total: (pos || []).reduce((sum: number, p: any) => sum + Number(p.total_amount || 0), 0).toFixed(2),
        },
        recruitment: {
          active_candidates: (candidates || []).length,
          by_status: candidateStatus,
        },
        meetings: {
          recent_count: (meetings || []).length,
        },
        issues: {
          total_recent: (issues || []).length,
          by_severity: issueSeverity,
        },
      };
    }

    case "get_google_analytics_dashboard": {
      if (!supabaseUrl || !authHeader) {
        return { connected: false, error: "Google Analytics requires an authenticated chat session." };
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/google-analytics-api`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "dashboard" }),
      });

      const data = await response.json().catch(() => ({}));
      if (data?.code === "NOT_CONNECTED" || data?.connected === false) {
        return { connected: false, error: "Google Analytics is not connected. Please connect it via the Integrations page." };
      }
      if (!response.ok) {
        return { connected: false, error: data?.error || `Google Analytics request failed (${response.status})` };
      }

      return data;
    }

    default:
      throw new Error(`Unknown analytics tool: ${toolName}`);
  }
}

// ==================== WORKSTREAM MANAGEMENT TOOLS ====================
const WORKSTREAM_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_team_members",
      description: "Look up available team members. Returns profile IDs, display names, departments, and roles. Use this FIRST to resolve names to user IDs before assigning cards or tasks.",
      parameters: {
        type: "object",
        properties: {
          name_filter: { type: "string", description: "Optional name to search for (fuzzy match)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_workstream_cards",
      description: "AUTHORITATIVE & SOLE source for all Duncan workstream cards and tasks. Workstreams is the canonical task/card system — Basecamp/Trello/Jira/Asana/Monday/Notion-tasks are NOT connected. If a user references a known project_tag (Lightning Strike Event, Website, K10 App, School Integrations) or asks for cards/tasks/to-dos/open work/'what's on my plate', CALL THIS TOOL DIRECTLY without asking which system they mean. Fast, focused list of workstream cards with their open tasks. Returns card title, status (red/amber/green/done), project tag, due date, assignee names, and open task titles. Set export_format='csv' for a downloadable CSV, or export_format='gsheet' to create a new Google Sheet in the user's own Google Drive (requires their Gmail/Google integration to be connected). Prefer this over get_workstream_analytics or get_operational_summary when the user wants an actual list (not just counts).",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["red", "amber", "green", "done", "open"], description: "Filter by status. 'open' = red+amber+green (excludes done). Default: open." },
          project_tag: { type: "string", enum: ["Lightning Strike Event", "Website", "K10 App", "School Integrations"], description: "Filter by project tag" },
          assignee: { type: "string", enum: ["me", "anyone"], description: "'me' = only cards assigned to the current user. Default: anyone." },
          overdue_only: { type: "boolean", description: "If true, only cards whose due_date has passed or that contain overdue open tasks." },
          include_tasks: { type: "boolean", description: "Include open task titles per card (default true)." },
          limit: { type: "number", description: "Max cards to return (default 30, max 1000 when exporting, otherwise 100)." },
          window: { type: "string", enum: ["today", "tomorrow", "this_week", "next_week"], description: "Filter cards whose due_date falls in this window, resolved in the caller's timezone. Use this instead of computing dates yourself." },
          export_format: { type: "string", enum: ["json", "csv", "gsheet"], description: "'csv' uploads a CSV to private storage and returns a 1-hour signed download_url. 'gsheet' creates a Google Sheet in the user's own Drive using their connected Google account and returns the spreadsheet URL. Default: json." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_workstream_card",
      description: "Create a new workstream card. The card is automatically assigned ONLY to the creator (current user). To assign to others, use update_workstream_card after creation. Returns the created card ID for chaining with add_tasks_to_card.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Card title" },
          description: { type: "string", description: "Card description" },
          status: { type: "string", enum: ["red", "amber", "green", "done"], description: "Card status (default: amber)" },
          project_tag: { type: "string", enum: ["Lightning Strike Event", "Website", "K10 App", "School Integrations"], description: "Project tag" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Priority (default: medium)" },
          due_date: { type: "string", description: "Due date in YYYY-MM-DD format" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_team_availability",
      description: "Check Google Calendar availability for one or more team members to find free time slots for scheduling tasks. Use this when assigning work to find when people are free. Requires the team member's user_id (get from list_team_members). Returns busy periods and suggested free slots.",
      parameters: {
        type: "object",
        properties: {
          user_ids: { type: "array", items: { type: "string" }, description: "Array of user_id UUIDs to check calendars for" },
          date: { type: "string", description: "Date to check in YYYY-MM-DD format (defaults to today in the caller's timezone). Ignored if 'window' is provided." },
          window: { type: "string", enum: ["today", "tomorrow", "this_week", "next_week"], description: "Resolve the check range in the caller's timezone. Preferred over date/days for natural-language windows like 'today' or 'this week'." },
          days: { type: "number", description: "Number of days to look ahead from `date` (default: 3, max: 7). Ignored if 'window' is provided." },
          task_duration_minutes: { type: "number", description: "How long the task needs in minutes (default: 60). Duncan uses this to find suitable free slots." },
        },
        required: ["user_ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_tasks_to_card",
      description: "Add multiple tasks/checklist items to an existing workstream card. Call after create_workstream_card with the returned card_id.",
      parameters: {
        type: "object",
        properties: {
          card_id: { type: "string", description: "The card ID to add tasks to" },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Task title" },
                description: { type: "string", description: "Task description" },
                due_date: { type: "string", description: "Due date in YYYY-MM-DD" },
                assignee_user_ids: { type: "array", items: { type: "string" }, description: "User IDs to assign to this task" },
              },
              required: ["title"],
            },
            description: "Array of tasks to create",
          },
        },
        required: ["card_id", "tasks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_workstream_card",
      description: "Update an existing workstream card's status, description, project tag, due date, or assignees.",
      parameters: {
        type: "object",
        properties: {
          card_id: { type: "string", description: "The card ID to update" },
          title: { type: "string", description: "New title" },
          description: { type: "string", description: "New description" },
          status: { type: "string", enum: ["red", "amber", "green", "done"], description: "New status" },
          project_tag: { type: "string", enum: ["Lightning Strike Event", "Website", "K10 App", "School Integrations"], description: "New project tag" },
          due_date: { type: "string", description: "New due date in YYYY-MM-DD" },
          assignee_user_ids: { type: "array", items: { type: "string" }, description: "Replace assignees with these user IDs" },
        },
        required: ["card_id"],
      },
    },
  },
];

// ==================== PLANNER (KEY EVENTS DIARY) TOOLS ====================
const PLANNER_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_planner_events",
      description: "List Planner / Key Events Diary entries (synced from Google Calendar). Returns title, start/end, owner, category, risk level, missing fields, and Duncan metadata. Use when the user asks about the planner, upcoming events, key events, what's coming up, risks in the diary, or which events are incomplete.",
      parameters: {
        type: "object",
        properties: {
          range: { type: "string", enum: ["upcoming", "past", "this_week", "next_week", "this_month", "all"], description: "Time range (default: upcoming)" },
          limit: { type: "number", description: "Max events to return (default 20, max 100)" },
          risk_level: { type: "string", enum: ["red", "amber", "green"], description: "Filter by risk level" },
          incomplete_only: { type: "boolean", description: "If true, return only events with missing fields" },
          search: { type: "string", description: "Case-insensitive title/objective search" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_planner_event_meta",
      description: "Update Duncan's Planner metadata for a key event (category, owner, objective, success metric, decision needed, risks, next action, risk level). Does NOT change the underlying Google Calendar event — for date/time/attendee changes use update_calendar_event. Always show a preview and get explicit user confirmation before calling for write operations.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "key_events.id (UUID)" },
          category: { type: "string", description: "Event category (e.g. 'Investor', 'Product', 'Internal')" },
          event_name: { type: "string" },
          owner: { type: "string", description: "Owner name or email" },
          objective: { type: "string" },
          success_metric: { type: "string" },
          decision_needed: { type: "string" },
          risks: { type: "string" },
          next_action: { type: "string" },
          risk_level: { type: "string", enum: ["red", "amber", "green"] },
          risk_reason: { type: "string" },
          is_complete: { type: "boolean" },
        },
        required: ["event_id"],
      },
    },
  },
];

async function executePlannerTool(
  toolName: string,
  args: any,
  supabaseAdmin: any,
): Promise<any> {
  switch (toolName) {
    case "list_planner_events": {
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
      let q = supabaseAdmin
        .from("key_events")
        .select("id, title, start_at, end_at, all_day, location, owner, category, event_name, objective, success_metric, decision_needed, risks, next_action, risk_level, risk_reason, missing_fields, is_complete, organizer_email, html_link, start_tz, calendar_id, google_event_id")
        .eq("deleted_in_google", false);

      const now = new Date().toISOString();
      const range = args.range ?? "upcoming";
      const startOfWeek = (offset = 0) => {
        const d = new Date();
        const day = d.getUTCDay() || 7; // Mon=1..Sun=7
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCDate(d.getUTCDate() - day + 1 + offset * 7);
        return d.toISOString();
      };
      const endOfWeek = (offset = 0) => {
        const d = new Date(startOfWeek(offset));
        d.setUTCDate(d.getUTCDate() + 7);
        return d.toISOString();
      };

      if (range === "upcoming") q = q.gte("start_at", now).order("start_at", { ascending: true });
      else if (range === "past") q = q.lt("start_at", now).order("start_at", { ascending: false });
      else if (range === "this_week") q = q.gte("start_at", startOfWeek(0)).lt("start_at", endOfWeek(0)).order("start_at", { ascending: true });
      else if (range === "next_week") q = q.gte("start_at", startOfWeek(1)).lt("start_at", endOfWeek(1)).order("start_at", { ascending: true });
      else if (range === "this_month") {
        const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
        const next = new Date(d); next.setUTCMonth(next.getUTCMonth() + 1);
        q = q.gte("start_at", d.toISOString()).lt("start_at", next.toISOString()).order("start_at", { ascending: true });
      } else q = q.order("start_at", { ascending: true });

      if (args.risk_level) q = q.eq("risk_level", args.risk_level);
      if (args.search) q = q.ilike("title", `%${args.search}%`);

      q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw new Error(`Failed to list planner events: ${error.message}`);

      let rows = data || [];
      if (args.incomplete_only) rows = rows.filter((r: any) => !r.is_complete || (r.missing_fields?.length ?? 0) > 0);
      // Inject source_type so the model can route mutations correctly.
      rows = rows.map((r: any) => ({
        ...r,
        source_type:
          r.calendar_id === "local" || (typeof r.google_event_id === "string" && r.google_event_id.startsWith("local:"))
            ? "planner"
            : "google",
      }));

      return { count: rows.length, range, events: rows };
    }

    case "update_planner_event_meta": {
      if (!args.event_id) throw new Error("event_id is required");
      const allowed = ["category", "event_name", "owner", "objective", "success_metric", "decision_needed", "risks", "next_action", "risk_level", "risk_reason", "is_complete"];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (args[k] !== undefined) patch[k] = args[k];
      if (Object.keys(patch).length === 0) return { error: "No fields to update" };
      patch.updated_at = new Date().toISOString();

      const { data, error } = await supabaseAdmin
        .from("key_events")
        .update(patch)
        .eq("id", args.event_id)
        .select("id, title, category, owner, objective, success_metric, decision_needed, risks, next_action, risk_level, is_complete")
        .maybeSingle();
      if (error) throw new Error(`Failed to update planner event: ${error.message}`);
      if (!data) return { error: "Event not found" };
      return { success: true, event: data };
    }

    default:
      throw new Error(`Unknown planner tool: ${toolName}`);
  }
}

async function executeWorkstreamTool(
  toolName: string,
  args: any,
  supabaseAdmin: any,
  userId: string,
  identity?: ResolvedIdentity,
  identityCache?: IdentityCache,
): Promise<any> {
  switch (toolName) {
    case "list_team_members": {
      let query = supabaseAdmin
        .from("profiles")
        .select("user_id, display_name, department, role_title")
        .eq("approval_status", "approved");

      if (args.name_filter) {
        query = query.ilike("display_name", `%${args.name_filter}%`);
      }

      const { data, error } = await query.order("display_name");
      if (error) throw new Error(`Failed to list team members: ${error.message}`);
      return { members: data || [], count: (data || []).length };
    }

    case "list_workstream_cards": {
      const wantCsv = args.export_format === "csv";
      const wantSheet = args.export_format === "gsheet";
      const isExport = wantCsv || wantSheet;
      const limit = Math.min(Math.max(args.limit ?? (isExport ? 500 : 30), 1), isExport ? 1000 : 100);
      const includeTasks = args.include_tasks !== false;
      const nowIso = new Date().toISOString();

      // Optional pre-filter to cards assigned to current user
      let restrictCardIds: string[] | null = null;
      if (args.assignee === "me") {
        const { data: myAssign } = await supabaseAdmin
          .from("workstream_card_assignees")
          .select("card_id")
          .eq("user_id", userId);
        restrictCardIds = (myAssign || []).map((r: any) => r.card_id);
        if (restrictCardIds.length === 0) {
          const rr = createReadResult({
            data: [],
            source: "workstreams_db",
            freshness_sla_seconds: 30,
            row_count: 0,
            filters_applied: { ...args, applied: "assignee=me (none)" },
            query_echo: "workstream_cards where assignee=me",
            empty_reason: "no_matches",
          });
          return { count: 0, cards: [], filter: { ...args, applied: "assignee=me (none)" }, read_result: rr, meta: { readResult: true } };
        }
      }

      let cardsQuery = supabaseAdmin
        .from("workstream_cards")
        .select("id, title, status, project_tag, due_date, priority, created_at")
        .is("archived_at", null)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(limit);

      if (args.status === "open") {
        cardsQuery = cardsQuery.in("status", ["red", "amber", "green"]);
      } else if (args.status) {
        cardsQuery = cardsQuery.eq("status", args.status);
      } else {
        cardsQuery = cardsQuery.in("status", ["red", "amber", "green"]);
      }
      if (args.project_tag) cardsQuery = cardsQuery.eq("project_tag", args.project_tag);
      if (restrictCardIds) cardsQuery = cardsQuery.in("id", restrictCardIds);
      if (args.overdue_only) cardsQuery = cardsQuery.lt("due_date", nowIso);

      // Caller-timezone window resolution (Phase 9.4 / 9.6).
      let resolvedWindow: { startISO: string; endISO: string; label: string; timezone: string } | null = null;
      if (args.window && identity) {
        resolvedWindow = resolveWindow(identity, args.window);
        cardsQuery = cardsQuery
          .gte("due_date", resolvedWindow.startISO)
          .lt("due_date", resolvedWindow.endISO);
      }

      const { data: cards, error } = await cardsQuery;
      if (error) throw new Error(`Failed to list workstream cards: ${error.message}`);
      const cardList = cards || [];
      const windowEcho = resolvedWindow
        ? ` window=${resolvedWindow.label}[${resolvedWindow.startISO}..${resolvedWindow.endISO}) tz=${resolvedWindow.timezone}`
        : "";
      const filtersWithWindow = resolvedWindow
        ? { ...args, resolved_window: resolvedWindow }
        : args;
      if (cardList.length === 0) {
        const rr = createReadResult({
          data: [],
          source: "workstreams_db",
          freshness_sla_seconds: 30,
          row_count: 0,
          filters_applied: filtersWithWindow,
          query_echo: `workstream_cards where status=${args.status ?? "open"}${args.project_tag ? ` project_tag=${args.project_tag}` : ""}${windowEcho}`,
          empty_reason: "no_matches",
        });
        return { count: 0, cards: [], filter: filtersWithWindow, read_result: rr, meta: { readResult: true } };
      }

      const cardIds = cardList.map((c: any) => c.id);

      // Fetch assignees + open tasks in parallel
      const [assigneesRes, tasksRes] = await Promise.all([
        supabaseAdmin
          .from("workstream_card_assignees")
          .select("card_id, user_id")
          .in("card_id", cardIds),
        includeTasks
          ? supabaseAdmin
              .from("workstream_tasks")
              .select("id, card_id, title, due_date, completed")
              .in("card_id", cardIds)
              .eq("completed", false)
              .order("due_date", { ascending: true, nullsFirst: false })
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const assigneeRows = (assigneesRes as any).data || [];
      const tasks = (tasksRes as any).data || [];

      // Resolve assignee names
      const userIds = Array.from(new Set(assigneeRows.map((a: any) => a.user_id)));
      const nameById: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profs } = await supabaseAdmin
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", userIds);
        for (const p of profs || []) nameById[p.user_id] = p.display_name || "Unknown";
      }

      const assigneesByCard: Record<string, string[]> = {};
      for (const a of assigneeRows) {
        (assigneesByCard[a.card_id] ||= []).push(nameById[a.user_id] || "Unknown");
      }

      const tasksByCard: Record<string, any[]> = {};
      for (const t of tasks) {
        (tasksByCard[t.card_id] ||= []).push({
          title: t.title,
          due_date: t.due_date,
          overdue: !!(t.due_date && t.due_date < nowIso),
        });
      }

      let result = cardList.map((c: any) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        project_tag: c.project_tag,
        due_date: c.due_date,
        priority: c.priority,
        overdue: !!(c.due_date && c.due_date < nowIso),
        assignees: assigneesByCard[c.id] || [],
        open_tasks: includeTasks ? (tasksByCard[c.id] || []) : undefined,
        open_task_count: includeTasks ? (tasksByCard[c.id] || []).length : undefined,
      }));

      if (args.overdue_only) {
        // Already filtered card-level; also keep cards with overdue tasks even if card has no due date
        const overdueTaskCardIds = new Set(Object.entries(tasksByCard)
          .filter(([_, ts]) => (ts as any[]).some((t) => t.overdue))
          .map(([id]) => id));
        result = result.filter((r: any) => r.overdue || overdueTaskCardIds.has(r.id));
      }

      if (wantCsv) {
        const esc = (v: any) => {
          if (v === null || v === undefined) return "";
          const s = Array.isArray(v) ? v.join("; ") : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const header = ["Title", "Status", "Project", "Priority", "Due Date", "Overdue", "Assignees", "Open Task Count", "Open Tasks"];
        const lines = [header.join(",")];
        for (const r of result) {
          const taskTitles = (r.open_tasks || []).map((t: any) => t.overdue ? `${t.title} (OVERDUE)` : t.title);
          lines.push([
            esc(r.title), esc(r.status), esc(r.project_tag), esc(r.priority),
            esc(r.due_date), esc(r.overdue ? "yes" : ""), esc(r.assignees),
            esc(r.open_task_count ?? ""), esc(taskTitles),
          ].join(","));
        }
        const csv = lines.join("\n");
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `workstream-cards-${ts}.csv`;
        const path = `workstreams/${userId}/${filename}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("exports")
          .upload(path, new Blob([csv], { type: "text/csv" }), {
            contentType: "text/csv",
            upsert: true,
          });
        if (upErr) throw new Error(`CSV upload failed: ${upErr.message}`);
        const { data: signed, error: signErr } = await supabaseAdmin.storage
          .from("exports")
          .createSignedUrl(path, 60 * 60, { download: filename });
        if (signErr || !signed?.signedUrl) throw new Error(`Sign URL failed: ${signErr?.message}`);
        return {
          count: result.length,
          format: "csv",
          filename,
          download_url: signed.signedUrl,
          expires_in_seconds: 3600,
          message: `CSV ready (${result.length} cards). Present the download_url to the user as a clickable markdown link: [Download ${filename}](${signed.signedUrl}). Do not paste the raw list inline.`,
        };
      }

      if (wantSheet) {
        // Load this user's Google (Gmail) tokens — same OAuth flow grants Sheets + Drive scopes.
        const { data: tokenRow } = await supabaseAdmin
          .from("gmail_tokens")
          .select("*")
          .eq("connected_by", userId)
          .maybeSingle();
        if (!tokenRow) {
          return { error: "no_google_connection", message: "I can't create a Google Sheet because you haven't connected your Google account yet. Go to Settings → Integrations → Gmail to connect, then try again." };
        }

        // Refresh access token if needed
        let accessToken: string = tokenRow.access_token;
        const expiry = new Date(tokenRow.token_expiry).getTime();
        if (expiry - Date.now() < 5 * 60 * 1000) {
          const clientId = Deno.env.get("GMAIL_CLIENT_ID");
          const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
          const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              refresh_token: tokenRow.refresh_token,
              client_id: clientId!,
              client_secret: clientSecret!,
              grant_type: "refresh_token",
            }),
          });
          if (!refreshRes.ok) {
            return { error: "google_refresh_failed", message: "Your Google connection has expired. Please reconnect in Settings → Integrations → Gmail." };
          }
          const refreshed = await refreshRes.json();
          accessToken = refreshed.access_token;
          await supabaseAdmin
            .from("gmail_tokens")
            .update({
              access_token: accessToken,
              token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
            })
            .eq("id", tokenRow.id);
        }

        // Verify required scopes
        const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
        const tokenInfo = tokenInfoRes.ok ? await tokenInfoRes.json() : {};
        const granted = new Set(String(tokenInfo.scope || "").split(/\s+/).filter(Boolean));
        const needSheets = !granted.has("https://www.googleapis.com/auth/spreadsheets");
        const needDrive = !granted.has("https://www.googleapis.com/auth/drive.file") && !granted.has("https://www.googleapis.com/auth/drive");
        if (needSheets || needDrive) {
          return {
            error: "missing_google_scopes",
            message: "Your Google connection is missing the permissions needed to create Sheets. Please go to Settings → Integrations → Gmail, disconnect, and reconnect — you'll be asked to approve Google Sheets and Drive access.",
          };
        }

        // Build sheet payload
        const headerRow = ["Title", "Status", "Project", "Priority", "Due Date", "Overdue", "Assignees", "Open Task Count", "Open Tasks"];
        const dataRows = result.map((r: any) => {
          const taskTitles = (r.open_tasks || []).map((t: any) => t.overdue ? `${t.title} (OVERDUE)` : t.title).join("; ");
          return [
            r.title || "",
            r.status || "",
            r.project_tag || "",
            r.priority || "",
            r.due_date || "",
            r.overdue ? "yes" : "",
            (r.assignees || []).join(", "),
            String(r.open_task_count ?? ""),
            taskTitles,
          ];
        });
        const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
        const title = `Duncan — Workstream cards (${ts} UTC)`;

        // Create spreadsheet with data inline
        const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            properties: { title },
            sheets: [{
              properties: { title: "Workstream Cards", gridProperties: { frozenRowCount: 1 } },
              data: [{
                startRow: 0,
                startColumn: 0,
                rowData: [headerRow, ...dataRows].map((row) => ({
                  values: row.map((v) => ({ userEnteredValue: { stringValue: String(v) } })),
                })),
              }],
            }],
          }),
        });
        if (!createRes.ok) {
          const txt = await createRes.text();
          return { error: "sheets_create_failed", message: `Failed to create Google Sheet: ${createRes.status} ${txt.slice(0, 300)}` };
        }
        const sheet = await createRes.json();
        const spreadsheetUrl: string = sheet.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/edit`;

        return {
          count: result.length,
          format: "gsheet",
          spreadsheet_id: sheet.spreadsheetId,
          spreadsheet_url: spreadsheetUrl,
          title,
          message: `Google Sheet created (${result.length} cards) in the user's own Google Drive. Present the URL as a clickable markdown link: [${title}](${spreadsheetUrl}). Do not paste the raw list inline.`,
        };
      }

      {
        const rr = createReadResult({
          data: result,
          source: "workstreams_db",
          freshness_sla_seconds: 30,
          row_count: result.length,
          truncated: result.length >= limit,
          filters_applied: filtersWithWindow,
          query_echo: `workstream_cards where status=${args.status ?? "open"}${args.project_tag ? ` project_tag=${args.project_tag}` : ""}${windowEcho} limit ${limit}`,
        });
        return { count: result.length, cards: result, filter: filtersWithWindow, read_result: rr, meta: { readResult: true } };
      }
    }


    case "create_workstream_card": {
      // Deduplication: check if a card with the same title + project_tag already exists for this creator
      const dedupQuery = supabaseAdmin
        .from("workstream_cards")
        .select("id, title, status, project_tag")
        .eq("title", args.title)
        .eq("created_by", userId)
        .is("archived_at", null);

      if (args.project_tag) {
        dedupQuery.eq("project_tag", args.project_tag);
      }

      const { data: existing } = await dedupQuery.limit(1);

      if (existing && existing.length > 0) {
        return { success: true, card_id: existing[0].id, title: existing[0].title, status: existing[0].status, project_tag: existing[0].project_tag, assigned_to: "creator (you)", already_existed: true, message: "Card already exists — skipped duplicate creation." };
      }

      const cardData: any = {
        title: args.title,
        description: args.description || "",
        status: args.status || "amber",
        project_tag: args.project_tag || null,
        priority: args.priority || "medium",
        due_date: args.due_date || null,
        created_by: userId,
        owner_id: userId,
      };

      const { data: card, error } = await supabaseAdmin
        .from("workstream_cards")
        .insert(cardData)
        .select("id, title, status, project_tag")
        .single();

      if (error) throw new Error(`Failed to create card: ${error.message}`);

      // Auto-assign only the creator
      await supabaseAdmin.from("workstream_card_assignees").insert({
        card_id: card.id,
        user_id: userId,
      });

      // Log activity
      await supabaseAdmin.from("workstream_activity").insert({
        card_id: card.id,
        user_id: userId,
        action: "created",
        details: { title: card.title, created_by_duncan: true, auto_assigned_to_creator: true },
      });

      return { success: true, card_id: card.id, title: card.title, status: card.status, project_tag: card.project_tag, assigned_to: "creator (you)" };
    }

    case "add_tasks_to_card": {
      const { card_id, tasks } = args;

      // Dedup: fetch existing task titles for this card
      const { data: existingTasks } = await supabaseAdmin
        .from("workstream_tasks")
        .select("title")
        .eq("card_id", card_id);
      const existingTitles = new Set((existingTasks || []).map((t: any) => t.title.toLowerCase()));

      const createdTasks: any[] = [];
      const skippedTasks: string[] = [];

      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];

        if (existingTitles.has(t.title.toLowerCase())) {
          skippedTasks.push(t.title);
          continue;
        }

        const { data: task, error } = await supabaseAdmin
          .from("workstream_tasks")
          .insert({
            card_id,
            title: t.title,
            description: t.description || "",
            due_date: t.due_date || null,
            sort_order: i,
            completed: false,
          })
          .select("id, title")
          .single();

        if (error) {
          console.error(`Failed to create task "${t.title}":`, error.message);
          continue;
        }

        if (t.assignee_user_ids?.length > 0) {
          const taskAssigneeRows = t.assignee_user_ids.map((uid: string) => ({
            task_id: task.id,
            user_id: uid,
          }));
          await supabaseAdmin.from("workstream_task_assignees").insert(taskAssigneeRows);
        }

        createdTasks.push({ id: task.id, title: task.title });
        existingTitles.add(t.title.toLowerCase());
      }

      if (createdTasks.length > 0) {
        await supabaseAdmin.from("workstream_activity").insert({
          card_id,
          user_id: userId,
          action: "tasks_added",
          details: { task_count: createdTasks.length, created_by_duncan: true },
        });
      }

      return { success: true, card_id, tasks_created: createdTasks.length, tasks_skipped: skippedTasks.length, tasks: createdTasks, skipped: skippedTasks };
    }

    case "update_workstream_card": {
      const { card_id, assignee_user_ids, ...updates } = args;
      const updateData: any = {};
      if (updates.title) updateData.title = updates.title;
      if (updates.description) updateData.description = updates.description;
      if (updates.status) {
        updateData.status = updates.status;
        // User-driven status changes via Duncan count as a manual override
        // so the overdue cron will not overwrite them.
        updateData.status_source = "manual";
        updateData.manual_status_set_at = new Date().toISOString();
      }
      if (updates.project_tag) updateData.project_tag = updates.project_tag;
      if (updates.due_date) updateData.due_date = updates.due_date;

      if (Object.keys(updateData).length > 0) {
        const { error } = await supabaseAdmin
          .from("workstream_cards")
          .update(updateData)
          .eq("id", card_id);
        if (error) throw new Error(`Failed to update card: ${error.message}`);
      }

      // Replace assignees if provided
      if (assignee_user_ids) {
        await supabaseAdmin.from("workstream_card_assignees").delete().eq("card_id", card_id);
        if (assignee_user_ids.length > 0) {
          const assigneeRows = assignee_user_ids.map((uid: string) => ({
            card_id,
            user_id: uid,
          }));
          await supabaseAdmin.from("workstream_card_assignees").insert(assigneeRows);
        }
      }

      // Log activity
      await supabaseAdmin.from("workstream_activity").insert({
        card_id,
        user_id: userId,
        action: "updated",
        details: { updates: Object.keys(updateData), updated_by_duncan: true },
      });

      return { success: true, card_id, updated_fields: Object.keys(updateData) };
    }

    case "check_team_availability": {
      const { user_ids, date, days: daysAhead, task_duration_minutes, window } = args;
      const callerTz = identity?.timezone ?? "UTC";
      let startDate: Date;
      let endDate: Date;
      let windowLabel: string;
      if (window && identity) {
        const w = resolveWindow(identity, window);
        startDate = new Date(w.startISO);
        endDate = new Date(w.endISO);
        windowLabel = w.label;
      } else if (date) {
        startDate = new Date(date + "T00:00:00Z");
        startDate.setUTCHours(0, 0, 0, 0);
        const numDays = Math.min(daysAhead || 3, 7);
        endDate = new Date(startDate.getTime() + numDays * 24 * 60 * 60 * 1000);
        windowLabel = `${date}+${numDays}d`;
      } else if (identity) {
        // Default: "today" in caller's timezone, then numDays ahead.
        const w = resolveWindow(identity, "today");
        startDate = new Date(w.startISO);
        const numDays = Math.min(daysAhead || 3, 7);
        endDate = new Date(startDate.getTime() + numDays * 24 * 60 * 60 * 1000);
        windowLabel = `today(${callerTz})+${numDays}d`;
      } else {
        startDate = new Date();
        startDate.setUTCHours(0, 0, 0, 0);
        const numDays = Math.min(daysAhead || 3, 7);
        endDate = new Date(startDate.getTime() + numDays * 24 * 60 * 60 * 1000);
        windowLabel = `utc+${numDays}d`;
      }
      const numDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
      const taskDuration = task_duration_minutes || 60;

      const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
      const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");

      if (!clientId || !clientSecret) {
        return { error: "Google Calendar credentials not configured. Cannot check availability." };
      }

      const results: any[] = [];

      for (const uid of user_ids) {
        // Get profile name
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("display_name")
          .eq("user_id", uid)
          .single();

        const memberName = profile?.display_name || uid;

        // Get their calendar token
        const { data: tokenData } = await supabaseAdmin
          .from("google_calendar_tokens")
          .select("*")
          .eq("user_id", uid)
          .single();

        if (!tokenData) {
          results.push({ user_id: uid, name: memberName, calendar_connected: false, note: "Calendar not connected — cannot check availability" });
          continue;
        }

        // Refresh token if expired
        let accessToken = tokenData.access_token;
        if (new Date(tokenData.token_expiry) <= new Date()) {
          const refreshResp = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: tokenData.refresh_token,
              grant_type: "refresh_token",
            }),
          });
          if (!refreshResp.ok) {
            results.push({ user_id: uid, name: memberName, calendar_connected: true, error: "Token refresh failed" });
            continue;
          }
          const newTokens = await refreshResp.json();
          accessToken = newTokens.access_token;
          await supabaseAdmin.from("google_calendar_tokens").update({
            access_token: accessToken,
            token_expiry: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
          }).eq("user_id", uid);
        }

        // Fetch events
        const eventsUrl = new URL(`${GOOGLE_CALENDAR_API}/calendars/primary/events`);
        eventsUrl.searchParams.set("timeMin", startDate.toISOString());
        eventsUrl.searchParams.set("timeMax", endDate.toISOString());
        eventsUrl.searchParams.set("singleEvents", "true");
        eventsUrl.searchParams.set("orderBy", "startTime");
        eventsUrl.searchParams.set("maxResults", "100");

        // Resolve per-member identity (timezone, working hours). Falls back to caller tz.
        const memberIdentity = identityCache
          ? await resolveIdentity(supabaseAdmin, uid, identityCache).catch(() => null)
          : null;
        const memberTz = memberIdentity?.timezone ?? callerTz;
        const memberWH = memberIdentity?.working_hours ?? { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] };
        eventsUrl.searchParams.set("timeZone", memberTz);

        const eventsResp = await fetch(eventsUrl.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!eventsResp.ok) {
          results.push({ user_id: uid, name: memberName, calendar_connected: true, error: "Failed to fetch calendar events" });
          continue;
        }

        const eventsData = await eventsResp.json();
        const events = (eventsData.items || [])
          .filter((e: any) => e.start?.dateTime && e.end?.dateTime)
          .map((e: any) => ({
            title: e.summary || "Busy",
            start: e.start.dateTime,
            end: e.end.dateTime,
          }));

        // Helper: convert a local "YYYY-MM-DD HH:MM" in tz to a UTC Date.
        const localInTzToUtc = (y: number, m: number, d: number, hh: number, mm: number, tz: string) => {
          const utcGuess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
          const offsetMin = (new Date(utcGuess.toLocaleString("en-US", { timeZone: tz })).getTime()
                            - utcGuess.getTime()) / 60000;
          return new Date(utcGuess.getTime() - offsetMin * 60000);
        };
        // Helper: get YYYY-MM-DD + day-of-week for a UTC instant in tz.
        const localPartsInTz = (dt: Date, tz: string) => {
          const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
            timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
          }).formatToParts(dt).map((p) => [p.type, p.value]));
          const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
          return {
            y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
            iso: `${parts.year}-${parts.month}-${parts.day}`,
            dow: dowMap[parts.weekday as string] ?? 0,
          };
        };

        const [whStartH, whStartM] = memberWH.start.split(":").map(Number);
        const [whEndH, whEndM] = memberWH.end.split(":").map(Number);

        // Find free slots in member's local working hours.
        const freeSlots: any[] = [];
        for (let d = 0; d < numDays; d++) {
          const dayInstant = new Date(startDate.getTime() + d * 86400000);
          const { y, m, d: dd, iso, dow } = localPartsInTz(dayInstant, memberTz);
          if (!memberWH.days.includes(dow)) continue; // not a working day for this member

          const workStart = localInTzToUtc(y, m, dd, whStartH, whStartM, memberTz);
          const workEnd = localInTzToUtc(y, m, dd, whEndH, whEndM, memberTz);

          // Get busy periods overlapping the work window
          const dayEvents = events.filter((e: any) => {
            const eStart = new Date(e.start);
            const eEnd = new Date(e.end);
            return eStart < workEnd && eEnd > workStart;
          }).sort((a: any, b: any) => new Date(a.start).getTime() - new Date(b.start).getTime());

          let cursor = workStart.getTime();
          for (const evt of dayEvents) {
            const evtStart = Math.max(new Date(evt.start).getTime(), workStart.getTime());
            const evtEnd = Math.min(new Date(evt.end).getTime(), workEnd.getTime());
            if (evtStart > cursor && (evtStart - cursor) >= taskDuration * 60 * 1000) {
              freeSlots.push({
                date: iso,
                start: new Date(cursor).toISOString(),
                end: new Date(evtStart).toISOString(),
                duration_minutes: Math.round((evtStart - cursor) / 60000),
              });
            }
            cursor = Math.max(cursor, evtEnd);
          }
          if (cursor < workEnd.getTime() && (workEnd.getTime() - cursor) >= taskDuration * 60 * 1000) {
            freeSlots.push({
              date: iso,
              start: new Date(cursor).toISOString(),
              end: workEnd.toISOString(),
              duration_minutes: Math.round((workEnd.getTime() - cursor) / 60000),
            });
          }
        }

        results.push({
          user_id: uid,
          name: memberName,
          calendar_connected: true,
          timezone: memberTz,
          working_hours: memberWH,
          busy_events_count: events.length,
          busy_events: events.slice(0, 15), // Cap to avoid token overflow
          free_slots: freeSlots,
          suggested_slot: freeSlots.length > 0 ? freeSlots[0] : null,
        });
      }

      return {
        availability: results,
        checked_from: startDate.toISOString(),
        checked_to: endDate.toISOString(),
        window: windowLabel,
        caller_timezone: callerTz,
        task_duration_minutes: taskDuration,
      };
    }

    default:
      throw new Error(`Unknown workstream tool: ${toolName}`);
  }
}

async function executeXeroTool(
  toolName: string,
  args: any,
  supabaseAdmin: any,
  supabaseUrl: string,
  authHeader: string,
  userId: string
): Promise<any> {
  const PAYMENT_APPROVER_ID = "00347694-6eab-4cc6-819a-01f13660f869"; // Patrick Badenoch
  switch (toolName) {
    case "list_xero_invoices": {
      let query = supabaseAdmin
        .from("xero_invoices")
        .select("id, external_id, invoice_number, contact_name, type, status, date, due_date, amount_due, amount_paid, total, currency_code, synced_at")
        .order("date", { ascending: false })
        .limit(args.limit || 25);

      if (args.status) query = query.eq("status", args.status);
      if (args.type) query = query.eq("type", args.type);
      if (args.search) query = query.or(`invoice_number.ilike.%${args.search}%,contact_name.ilike.%${args.search}%`);

      const { data, error } = await query;
      if (error) throw new Error(`Failed to list invoices: ${error.message}`);
      return {
        count: (data || []).length,
        invoices: (data || []).map((inv: any) => ({
          ...inv,
          total: Number(inv.total),
          amount_due: Number(inv.amount_due),
          amount_paid: Number(inv.amount_paid),
          type_label: inv.type === "ACCPAY" ? "Bill (Payable)" : inv.type === "ACCREC" ? "Invoice (Receivable)" : inv.type,
        })),
      };
    }

    case "get_xero_invoice": {
      const { data, error } = await supabaseAdmin
        .from("xero_invoices")
        .select("id, external_id, invoice_number, contact_name, contact_id, type, status, date, due_date, amount_due, amount_paid, total, currency_code, line_items, synced_at")
        .eq("id", args.invoice_id)
        .single();
      if (error) throw new Error(`Invoice not found: ${error.message}`);
      return {
        ...data,
        total: Number(data.total),
        amount_due: Number(data.amount_due),
        amount_paid: Number(data.amount_paid),
        type_label: data.type === "ACCPAY" ? "Bill (Payable)" : data.type === "ACCREC" ? "Invoice (Receivable)" : data.type,
      };
    }

    case "approve_xero_invoice_payment": {
      if (userId !== PAYMENT_APPROVER_ID) {
        return { error: "⛔ Access denied. Only Patrick Badenoch is authorised to approve invoice payments." };
      }
      if (!args.confirmed) {
        return { error: "Payment approval requires explicit user confirmation. Please ask the user to confirm before calling this tool with confirmed=true." };
      }

      // Get the invoice
      const { data: invoice, error } = await supabaseAdmin
        .from("xero_invoices")
        .select("id, external_id, invoice_number, contact_name, type, status, total, amount_due, currency_code")
        .eq("id", args.invoice_id)
        .single();
      if (error) throw new Error(`Invoice not found: ${error.message}`);

      if (invoice.type !== "ACCPAY") {
        return { error: "Only bills (ACCPAY type) can be approved for payment. This is a receivable invoice." };
      }
      if (invoice.status !== "AUTHORISED") {
        return { error: `Invoice status is "${invoice.status}". Only AUTHORISED invoices can be approved for payment.` };
      }

      const amount = Number(invoice.amount_due);

      if (amount >= 300) {
        return { error: `⛔ Invoice ${invoice.invoice_number} is for ${invoice.currency_code} ${amount.toFixed(2)} which exceeds the £300 approval limit. Invoices of £300 or more must be approved through a separate process.` };
      }

      // Call Xero API to verify invoice
      const res = await fetch(`${supabaseUrl}/functions/v1/xero-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ action: "get_invoice", invoiceId: invoice.external_id }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to verify invoice with Xero");
      }

      return {
        success: true,
        message: `✅ Invoice ${invoice.invoice_number} from ${invoice.contact_name} for ${invoice.currency_code} ${amount.toFixed(2)} has been approved for payment.`,
        invoice_number: invoice.invoice_number,
        contact: invoice.contact_name,
        amount: amount,
        currency: invoice.currency_code,
      };
    }

    case "search_xero_contacts": {
      const { data, error } = await supabaseAdmin
        .from("xero_contacts")
        .select("external_id, name, email, phone, contact_status, is_supplier, is_customer")
        .ilike("name", `%${args.search}%`)
        .limit(10);
      if (error) throw new Error(`Failed to search contacts: ${error.message}`);
      return {
        count: (data || []).length,
        contacts: data || [],
        hint: "Use the external_id as contact_id when creating an invoice.",
      };
    }

    case "create_xero_invoice": {
      if (!args.confirmed) {
        return { error: "Invoice submission requires explicit user confirmation. Please show the user all details and ask them to confirm before calling this tool with confirmed=true." };
      }

      const lineItems = (args.line_items || []).map((item: any) => ({
        Description: item.description,
        Quantity: item.quantity || 1,
        UnitAmount: item.unit_amount,
        AccountCode: item.account_code || (args.type === "ACCREC" ? "200" : "400"),
        TaxType: item.tax_type || "OUTPUT2",
      }));

      if (lineItems.length === 0) {
        return { error: "At least one line item is required." };
      }

      const invoice: any = {
        Type: args.type,
        Contact: { ContactID: args.contact_id },
        LineItems: lineItems,
        Status: args.status || "DRAFT",
        CurrencyCode: args.currency_code || "GBP",
        LineAmountTypes: "Exclusive",
      };

      if (args.date) invoice.Date = args.date;
      if (args.due_date) invoice.DueDate = args.due_date;
      if (args.reference) invoice.Reference = args.reference;

      // Call Xero API to create the invoice
      const res = await fetch(`${supabaseUrl}/functions/v1/xero-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ action: "create_invoice", invoice }),
      });

      const resData = await res.json();
      if (!res.ok) {
        const details = resData?.details?.Elements?.[0]?.ValidationErrors
          ?.map((e: any) => e.Message).join("; ") || JSON.stringify(resData);
        throw new Error(`Failed to create invoice: ${details}`);
      }

      const created = resData?.Invoices?.[0];
      if (!created) throw new Error("No invoice returned from Xero");

      // Sync the new invoice to local database
      try {
        await supabaseAdmin.from("xero_invoices").upsert({
          external_id: created.InvoiceID,
          invoice_number: created.InvoiceNumber || null,
          contact_name: args.contact_name,
          contact_id: args.contact_id,
          type: created.Type,
          status: created.Status,
          date: created.Date ? created.Date.split("T")[0] : null,
          due_date: created.DueDate ? created.DueDate.split("T")[0] : null,
          total: created.Total || 0,
          amount_due: created.AmountDue || 0,
          amount_paid: created.AmountPaid || 0,
          currency_code: created.CurrencyCode || "GBP",
          line_items: created.LineItems || [],
          raw_data: created,
          synced_at: new Date().toISOString(),
        }, { onConflict: "external_id" });
      } catch (syncErr) {
        console.warn("Failed to sync new invoice to local DB:", syncErr);
      }

      const typeLabel = args.type === "ACCPAY" ? "Bill" : "Sales Invoice";
      const total = Number(created.Total || 0).toFixed(2);
      return {
        success: true,
        message: `✅ ${typeLabel} created successfully in Xero as **${created.Status}**.`,
        invoice_id: created.InvoiceID,
        invoice_number: created.InvoiceNumber || "TBD (Draft)",
        contact: args.contact_name,
        type: typeLabel,
        status: created.Status,
        total: `${created.CurrencyCode || "GBP"} ${total}`,
        line_items_count: lineItems.length,
      };
    }

    case "list_xero_bank_accounts": {
      const res = await fetch(`${supabaseUrl}/functions/v1/xero-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ action: "list_bank_accounts" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to list bank accounts");
      const accounts = (data.Accounts || []).map((a: any) => ({
        account_id: a.AccountID,
        name: a.Name,
        code: a.Code,
        currency: a.CurrencyCode,
        type: a.Type,
        status: a.Status,
      }));
      return { count: accounts.length, accounts, hint: "Use account_id as bank_account_id when creating an expense." };
    }

    case "create_xero_expense": {
      if (!args.confirmed) {
        return { error: "Expense recording requires explicit user confirmation. Please show the user all details and ask them to confirm before calling this tool with confirmed=true." };
      }

      const lineItems = (args.line_items || []).map((item: any) => ({
        Description: item.description,
        Quantity: item.quantity || 1,
        UnitAmount: item.unit_amount,
        AccountCode: item.account_code || "429",
        TaxType: item.tax_type || "INPUT2",
      }));

      if (lineItems.length === 0) {
        return { error: "At least one line item is required." };
      }

      const bankTransaction: any = {
        Type: "SPEND",
        Contact: { ContactID: args.contact_id },
        BankAccount: { AccountID: args.bank_account_id },
        LineItems: lineItems,
        CurrencyCode: args.currency_code || "GBP",
        LineAmountTypes: "Exclusive",
      };

      if (args.date) bankTransaction.Date = args.date;
      if (args.reference) bankTransaction.Reference = args.reference;

      const res = await fetch(`${supabaseUrl}/functions/v1/xero-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ action: "create_expense", bank_transaction: bankTransaction }),
      });

      const resData = await res.json();
      if (!res.ok) {
        const details = resData?.details?.Elements?.[0]?.ValidationErrors
          ?.map((e: any) => e.Message).join("; ") || JSON.stringify(resData);
        throw new Error(`Failed to record expense: ${details}`);
      }

      const created = resData?.BankTransactions?.[0];
      if (!created) throw new Error("No bank transaction returned from Xero");

      const total = Number(created.Total || 0).toFixed(2);
      return {
        success: true,
        message: `✅ Expense recorded successfully in Xero.`,
        transaction_id: created.BankTransactionID,
        contact: args.contact_name,
        total: `${created.CurrencyCode || "GBP"} ${total}`,
        date: created.Date,
        reference: created.Reference || "",
        line_items_count: lineItems.length,
      };
    }

    default:
      throw new Error(`Unknown Xero tool: ${toolName}`);
  }
}

async function executeGmailTool(
  toolName: string,
  args: any,
  supabaseUrl: string,
  authHeader: string,
  identity?: ResolvedIdentity,
): Promise<any> {
  async function callGmailApi(action: string, body: Record<string, any> = {}) {
    const res = await fetch(`${supabaseUrl}/functions/v1/gmail-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Gmail API ${action} failed`);
    if (data.error) throw new Error(data.error);
    return data;
  }

  // Translate a caller-TZ window into Gmail after:/before: clauses (yyyy/mm/dd).
  function windowToGmailQuery(window?: string): { suffix: string; window?: any } {
    if (!window || !identity) return { suffix: "" };
    const w = resolveWindow(identity, window as any);
    const after = localDateInTz(new Date(w.startISO), identity.timezone).replaceAll("-", "/");
    const before = localDateInTz(new Date(w.endISO), identity.timezone).replaceAll("-", "/");
    return { suffix: ` after:${after} before:${before}`, window: { ...w, after, before } };
  }

  switch (toolName) {
    case "list_gmail_emails": {
      const maxResults = Math.min(args.maxResults || 15, 25);
      const win = windowToGmailQuery(args.window);
      const data = win.suffix
        ? await callGmailApi("search", { query: `in:inbox${win.suffix}`.trim(), maxResults })
        : await callGmailApi("list", { maxResults });
      const emails = (data.emails || []).map((e: any) => ({
        id: e.id, from: e.from, subject: e.subject, date: e.date, snippet: e.snippet, unread: e.isUnread,
      }));
      const filters = { maxResults, ...(win.window ? { resolved_window: win.window } : {}) };
      const queryEcho = `gmail list inbox${win.suffix} maxResults=${maxResults}`;
      if (emails.length === 0) {
        const rr = createReadResult({
          data: [], source: "gmail", freshness_sla_seconds: 60, row_count: 0,
          filters_applied: filters, query_echo: queryEcho, empty_reason: "no_matches",
        });
        return { count: 0, emails: [], read_result: rr, meta: { readResult: true }, hint: "No matching messages." };
      }
      const rr = createReadResult({
        data: emails, source: "gmail", freshness_sla_seconds: 60, row_count: emails.length,
        truncated: emails.length >= maxResults, filters_applied: filters, query_echo: queryEcho,
      });
      return {
        count: emails.length, emails, read_result: rr, meta: { readResult: true },
        hint: "Use the 'id' with read_gmail_email to get full content.",
      };
    }

    case "search_gmail": {
      const maxResults = Math.min(args.maxResults || 15, 25);
      const win = windowToGmailQuery(args.window);
      const query = `${args.query}${win.suffix}`.trim();
      const data = await callGmailApi("search", { query, maxResults });
      const emails = (data.emails || []).map((e: any) => ({
        id: e.id, from: e.from, subject: e.subject, date: e.date, snippet: e.snippet, unread: e.isUnread,
      }));
      const filters = { query: args.query, maxResults, ...(win.window ? { resolved_window: win.window } : {}) };
      const queryEcho = `gmail search "${query}" maxResults=${maxResults}`;
      if (emails.length === 0) {
        const rr = createReadResult({
          data: [], source: "gmail", freshness_sla_seconds: 60, row_count: 0,
          filters_applied: filters, query_echo: queryEcho, empty_reason: "no_matches",
        });
        return { count: 0, emails: [], read_result: rr, meta: { readResult: true } };
      }
      const rr = createReadResult({
        data: emails, source: "gmail", freshness_sla_seconds: 60, row_count: emails.length,
        truncated: emails.length >= maxResults, filters_applied: filters, query_echo: queryEcho,
      });
      return {
        count: emails.length, emails, read_result: rr, meta: { readResult: true },
        hint: "Use the 'id' with read_gmail_email to get full content.",
      };
    }

    case "read_gmail_email": {
      const data = await callGmailApi("read", { messageId: args.messageId });
      const body = data.textBody || data.htmlBody?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000) || data.snippet;
      const payload = {
        id: data.id, from: data.from, to: data.to, cc: data.cc || null,
        subject: data.subject, date: data.date, body, unread: data.isUnread,
      };
      const rr = createReadResult({
        data: payload, source: "gmail", freshness_sla_seconds: 300, row_count: 1,
        filters_applied: { messageId: args.messageId },
        query_echo: `gmail read message=${args.messageId}`,
      });
      return { ...payload, read_result: rr, meta: { readResult: true } };
    }

    case "send_gmail_email": {
      if (!args.confirmed) {
        return { error: "Sending an email requires explicit user confirmation. Show the user the draft (to, subject, body) and ask them to confirm before calling with confirmed=true." };
      }
      const data = await callGmailApi("send", {
        to: args.to,
        cc: args.cc || "",
        bcc: args.bcc || "",
        subject: args.subject,
        body: args.body,
      });
      return {
        success: true,
        message: `✅ Email sent successfully to ${args.to}.`,
        messageId: data.messageId,
      };
    }
  }

  // Extra cases (drafts/threads) — declared after switch for cleanliness
  if (toolName === "read_gmail_thread") {
    const data = await callGmailApi("read_thread", { threadId: args.threadId, maxMessages: 5 });
    return {
      threadId: data.threadId,
      totalMessages: data.totalMessages,
      messages: (data.messages || []).map((m: any) => ({
        id: m.id,
        from: m.from,
        to: m.to,
        cc: m.cc,
        subject: m.subject,
        date: m.date,
        messageIdHeader: m.messageIdHeader,
        references: m.references,
        body: (m.textBody || m.snippet || "").slice(0, 4000),
      })),
      hint: "Use messageIdHeader from the message you're replying to as the 'messageId' arg in draft_gmail_reply.",
    };
  }

  if (toolName === "draft_gmail_reply") {
    const data = await callGmailApi("create_draft", {
      to: args.to,
      cc: args.cc || "",
      bcc: args.bcc || "",
      subject: args.subject,
      body: args.body,
      threadId: args.threadId,
      inReplyTo: args.messageId || "",
      references: args.references || args.messageId || "",
    });
    return {
      success: true,
      message: `📝 Draft reply saved to Gmail Drafts. Open it in Gmail to review and send.`,
      draftId: data.draftId,
      draftUrl: data.draftUrl,
    };
  }

  if (toolName === "draft_gmail_email") {
    const data = await callGmailApi("create_draft", {
      to: args.to,
      cc: args.cc || "",
      bcc: args.bcc || "",
      subject: args.subject,
      body: args.body,
    });
    return {
      success: true,
      message: `📝 Draft saved to Gmail Drafts. Open it in Gmail to review and send.`,
      draftId: data.draftId,
      draftUrl: data.draftUrl,
    };
  }

  throw new Error(`Unknown Gmail tool: ${toolName}`);
}

async function executeDriveTool(
  toolName: string,
  args: any,
  supabaseUrl: string,
  authHeader: string,
  _identity?: ResolvedIdentity,
): Promise<any> {
  async function callDriveApi(action: string, body: Record<string, any> = {}) {
    const res = await fetch(`${supabaseUrl}/functions/v1/google-drive-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Drive API ${action} failed`);
    if (data.error) throw new Error(data.error);
    return data;
  }

  switch (toolName) {
    case "drive_list_files": {
      const WEEKLY_REPORTS_FOLDER = "1R5JxrnLsSGPu4iRMqn02oCOHmGbRSW7G";
      let folderId = args.folderId;
      if (!folderId || folderId === "." || folderId === "/" || folderId === "root" || folderId.length < 5) {
        folderId = WEEKLY_REPORTS_FOLDER;
      }
      const data = await callDriveApi("list", { folderId, query: args.query });
      const files = (data.files || []).map((f: any) => ({
        id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime,
        isFolder: f.mimeType === "application/vnd.google-apps.folder",
      }));
      const filters = { folderId, query: args.query ?? null };
      const queryEcho = `drive list folder=${folderId}${args.query ? ` query="${args.query}"` : ""}`;
      if (files.length === 0) {
        const rr = createReadResult({
          data: [], source: "google_drive", freshness_sla_seconds: 300, row_count: 0,
          filters_applied: filters, query_echo: queryEcho, empty_reason: "no_matches",
        });
        return { files: [], read_result: rr, meta: { readResult: true } };
      }
      const rr = createReadResult({
        data: files, source: "google_drive", freshness_sla_seconds: 300, row_count: files.length,
        filters_applied: filters, query_echo: queryEcho,
      });
      return {
        files, read_result: rr, meta: { readResult: true },
        hint: "Use file 'id' with drive_get_content to read a file, or with drive_list_files as folderId to enter a folder.",
      };
    }

    case "drive_search": {
      const data = await callDriveApi("search", { name: args.name, mimeType: args.mimeType, parentId: args.parentId });
      const files = (data.files || []).map((f: any) => ({
        id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime,
        isFolder: f.mimeType === "application/vnd.google-apps.folder",
      }));
      const filters = { name: args.name ?? null, mimeType: args.mimeType ?? null, parentId: args.parentId ?? null };
      const queryEcho = `drive search name="${args.name ?? ""}" mime=${args.mimeType ?? "*"}`;
      if (files.length === 0) {
        const rr = createReadResult({
          data: [], source: "google_drive", freshness_sla_seconds: 300, row_count: 0,
          filters_applied: filters, query_echo: queryEcho, empty_reason: "no_matches",
        });
        return { files: [], read_result: rr, meta: { readResult: true } };
      }
      const rr = createReadResult({
        data: files, source: "google_drive", freshness_sla_seconds: 300, row_count: files.length,
        filters_applied: filters, query_echo: queryEcho,
      });
      return { files, read_result: rr, meta: { readResult: true } };
    }

    case "drive_get_content": {
      const data = await callDriveApi("get_content", { fileId: args.fileId, mimeType: args.mimeType });
      const payload = {
        content: data.content,
        truncated: data.truncated || false,
        encoding: data.encoding || "text",
      };
      const rr = createReadResult({
        data: payload, source: "google_drive", freshness_sla_seconds: 600, row_count: 1,
        truncated: payload.truncated,
        filters_applied: { fileId: args.fileId, mimeType: args.mimeType },
        query_echo: `drive get_content file=${args.fileId}`,
      });
      return { ...payload, read_result: rr, meta: { readResult: true } };
    }

    default:
      throw new Error(`Unknown Drive tool: ${toolName}`);
  }
}

async function executeExecSummaryTool(
  toolName: string,
  args: any,
  supabaseUrl: string,
  authHeader: string
): Promise<any> {
  if (toolName !== "generate_exec_summary_document") {
    throw new Error(`Unknown exec summary tool: ${toolName}`);
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/generate-exec-summary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      title: args.title,
      week_range: args.week_range,
      content: args.content,
    }),
  });

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Failed to generate executive summary document");
  return result;
}

async function executeHubspotTool(
  toolName: string,
  args: any,
  supabaseUrl: string,
  authHeader: string,
): Promise<any> {
  const call = async (body: Record<string, unknown>) => {
    const res = await fetch(`${supabaseUrl}/functions/v1/hubspot-api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `hubspot-api ${res.status}`);
    return data;
  };

  switch (toolName) {
    case "get_hubspot_pipeline_summary": {
      const data = await call({ action: "team_briefing_summary" });
      if (data?.status && data.status !== "connected") {
        return {
          status: data.status,
          message: data.error_message || "HubSpot is not connected or returned a degraded response.",
          error_code: data.error_code || null,
        };
      }
      // Trim payload — drop verbose diagnostics, raw signals, and credential metadata.
      const {
        credential_diagnostics, signals, ok, verification_path, credential_source, last_verified_at, last_sync_at,
        ...trimmed
      } = data || {};
      return trimmed;
    }

    case "search_hubspot": {
      if (!args?.query || typeof args.query !== "string") {
        return { error: "query is required" };
      }
      const data = await call({
        action: "search",
        query: args.query,
        objects: Array.isArray(args.objects) ? args.objects : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
      return data;
    }

    default:
      return { error: `Unknown HubSpot tool: ${toolName}` };
  }
}



async function executeAzureDevOpsTool(
  toolName: string,
  args: any,
  supabaseAdmin: any,
  supabaseUrl: string,
  authHeader: string
): Promise<any> {
  switch (toolName) {
    case "list_azure_devops_projects": {
      const res = await fetch(`${supabaseUrl}/functions/v1/azure-devops-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ action: "list_projects" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to list projects");
      const projects = (data.value || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        state: p.state,
        description: p.description,
      }));
      return { count: projects.length, projects };
    }

    case "query_azure_work_items": {
      // First get IDs via WIQL
      const wiqlRes = await fetch(`${supabaseUrl}/functions/v1/azure-devops-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ action: "query_work_items", project: args.project, wiql: args.wiql }),
      });
      const wiqlData = await wiqlRes.json();
      if (!wiqlRes.ok) throw new Error(wiqlData.error || "WIQL query failed");

      const ids = (wiqlData.workItems || []).map((w: any) => w.id).slice(0, 50);
      if (ids.length === 0) return { count: 0, work_items: [] };

      // Fetch details from local DB first (faster)
      const { data: localItems } = await supabaseAdmin
        .from("azure_work_items")
        .select("external_id, title, state, work_item_type, assigned_to, priority, tags, project_name, iteration_path, changed_date")
        .in("external_id", ids);

      const localMap = new Map((localItems || []).map((i: any) => [i.external_id, i]));
      const results = ids.map((id: number) => localMap.get(id) || { external_id: id, title: "(not synced locally)" });

      return { count: results.length, total_matched: (wiqlData.workItems || []).length, work_items: results };
    }

    case "get_azure_work_item": {
      // Try local DB first
      const { data: localItem } = await supabaseAdmin
        .from("azure_work_items")
        .select("*")
        .eq("external_id", args.work_item_id)
        .maybeSingle();

      if (localItem) {
        return {
          ...localItem,
          description: localItem.description ? localItem.description.slice(0, 3000) : null,
          raw_data: undefined, // too large for context
        };
      }

      // Fallback to live API
      const res = await fetch(`${supabaseUrl}/functions/v1/azure-devops-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ action: "get_work_item", workItemId: args.work_item_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get work item");
      const fields = data.fields || {};
      return {
        id: data.id,
        title: fields["System.Title"],
        state: fields["System.State"],
        work_item_type: fields["System.WorkItemType"],
        assigned_to: fields["System.AssignedTo"]?.displayName,
        priority: fields["Microsoft.VSTS.Common.Priority"],
        tags: fields["System.Tags"],
        area_path: fields["System.AreaPath"],
        iteration_path: fields["System.IterationPath"],
        description: (fields["System.Description"] || "").slice(0, 3000),
        created_date: fields["System.CreatedDate"],
        changed_date: fields["System.ChangedDate"],
      };
    }

    case "search_synced_work_items": {
      let query = supabaseAdmin
        .from("azure_work_items")
        .select("external_id, title, state, work_item_type, assigned_to, priority, tags, project_name, iteration_path, area_path, changed_date")
        .order("changed_date", { ascending: false })
        .limit(args.limit || 25);

      if (args.state) query = query.eq("state", args.state);
      if (args.work_item_type) query = query.eq("work_item_type", args.work_item_type);
      if (args.project_name) query = query.eq("project_name", args.project_name);
      if (args.assigned_to) query = query.ilike("assigned_to", `%${args.assigned_to}%`);
      if (args.search) query = query.or(`title.ilike.%${args.search}%,tags.ilike.%${args.search}%`);

      const { data, error } = await query;
      if (error) throw new Error(`Search failed: ${error.message}`);
      return { count: (data || []).length, work_items: data || [] };
    }

    default:
      throw new Error(`Unknown Azure DevOps tool: ${toolName}`);
  }
}

async function executeAzureReposTool(
  toolName: string,
  args: any,
  supabaseUrl: string,
  authHeader: string,
): Promise<any> {
  const callRepos = async (action: string, payload: Record<string, unknown> = {}) => {
    const res = await fetch(`${supabaseUrl}/functions/v1/azure-repos-api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `azure-repos-api ${action} failed (${res.status})`);
    return data;
  };

  switch (toolName) {
    case "list_azure_repos":
      return await callRepos("list_repos");

    case "get_recent_commits":
      return await callRepos("get_recent_commits", {
        days: args.days,
        top: args.top,
        project: args.project,
        repository_id: args.repository_id,
        author: args.author,
      });

    case "list_pull_requests":
      return await callRepos("list_pull_requests", {
        status: args.status,
        top: args.top,
        project: args.project,
        repository_id: args.repository_id,
      });

    case "get_pr_reviews":
      return await callRepos("get_pr_threads", {
        project: args.project,
        repository_id: args.repository_id,
        pull_request_id: args.pull_request_id,
      });

    case "get_repos_team_summary":
      return await callRepos("team_activity_summary", { days: args.days });

    default:
      throw new Error(`Unknown Azure Repos tool: ${toolName}`);
  }
}

async function executeMeetingTool(
  toolName: string,
  args: any,
  supabaseAdmin: any,
  supabaseUser: any,
  supabaseUrl: string,
  authHeader: string,
  userId: string,
  meetingFlowState?: { listedIds: Set<string>; sourceFallbackIds?: Set<string>; userIntent: string },
  identity?: ResolvedIdentity,
): Promise<any> {
  // Resolve caller-TZ window once. If args.window provided, derive from_date/to_date in caller's tz.
  let resolvedMeetingWindow: { startISO: string; endISO: string; label: string; timezone: string; from_date: string; to_date: string } | null = null;
  if (args?.window && identity) {
    const w = resolveWindow(identity, args.window);
    const from_date = localDateInTz(new Date(w.startISO), identity.timezone);
    // endISO is exclusive; subtract 1 day for inclusive to_date.
    const to_date = localDateInTz(new Date(new Date(w.endISO).getTime() - 86400000), identity.timezone);
    resolvedMeetingWindow = { ...w, from_date, to_date };
    args = { ...args, from_date, to_date };
  }
  const intent = meetingFlowState?.userIntent || "";
  let corrected = false;

  // Detect meeting-related intent — broader net to catch all variations
  const MY_MEETINGS_RE = /\b(my|latest|recent|today'?s|yesterday'?s|this week'?s)\b[^.?!]{0,40}\bmeetings?\b|\bmeeting notes\b|\bsummari[sz]e (my|recent|latest) meetings\b/i;
  const BROAD_MEETING_RE = /\b(meeting|meetings|notes|discussion|call|standup|stand-up|recap|summary)\b/i;
  const isMyMeetingsIntent =
    MY_MEETINGS_RE.test(intent) ||
    (BROAD_MEETING_RE.test(intent) && /\b(my|i|me|mine|our)\b/i.test(intent));

  // Detect whether the user already specified a source (Gemini / Google Meet / Plaud).
  const SOURCE_MENTIONED_RE = /\b(gemini|google\s*meet|google-meet|googlemeet|gemini-?notes|plaud)\b/i;
  const userSpecifiedSource = SOURCE_MENTIONED_RE.test(intent);
  const sourceArgProvided = args?.source === "gemini" || args?.source === "plaud";
  const explicitPlaudSyncRequested = /\b(sync|refresh|import|pull\s+new|update)\b[^.?!]{0,40}\b(plaud|recordings?)\b|\b(plaud|recordings?)\b[^.?!]{0,40}\b(sync|refresh|import|pull\s+new|update)\b/i.test(intent);

  console.log("[MEETING FLOW]", {
    user: userId,
    tool: toolName,
    args,
    isMyMeetingsIntent,
    userSpecifiedSource,
    listedSoFar: meetingFlowState?.listedIds.size ?? 0,
    intent_excerpt: intent.slice(0, 120),
  });

  // GUARD 0 (NEW): If the user asked for "my/latest meeting(s)" but did NOT specify a
  // source, do NOT run any meeting tool. Return an ASK_SOURCE payload so the model is
  // forced to ask the user to choose Google Meet (Gemini) vs Plaud first.
  if (
    isMyMeetingsIntent &&
    !userSpecifiedSource &&
    !sourceArgProvided &&
    meetingFlowState &&
    meetingFlowState.listedIds.size === 0 &&
    !(toolName === "fetch_plaud_meetings" && explicitPlaudSyncRequested) &&
    toolName !== "get_action_items_for_range" &&
    !(toolName === "list_meetings" && (args?.window || args?.from_date || args?.to_date))
  ) {
    console.log("[MEETING FLOW] ASK_SOURCE — blocking", toolName, "until user picks source");
    return {
      ask_source: true,
      empty: true,
      meetings: [],
      message:
        "Which source should I use — Google Meet or Plaud?",
      instructions:
        "Reply to the user with the message above verbatim and STOP. Do NOT call any meeting tool until they pick 'gemini' or 'plaud'. Once they answer, immediately call list_meetings_by_source with the chosen source and return the latest notes without asking summary/full/paste follow-ups.",
      options: ["gemini", "plaud"],
    };
  }

  // GUARD 1: For "my meetings" intent WITH a specified source, the FIRST meeting tool call
  // should be list_meetings_by_source (source-based retrieval).
  if (
    isMyMeetingsIntent &&
    userSpecifiedSource &&
    meetingFlowState &&
    meetingFlowState.listedIds.size === 0 &&
    toolName !== "list_meetings" &&
    toolName !== "list_meetings_by_source" &&
    toolName !== "fetch_plaud_meetings"
  ) {
    console.warn("[MEETING FLOW] AUTO-CORRECT — forcing list_meetings_by_source before", toolName);
    corrected = true;
    const inferredSource = /plaud/i.test(intent) ? "plaud" : "gemini";
    const recovery = await executeMeetingTool(
      "list_meetings_by_source",
      { source: inferredSource, limit: 5 },
      supabaseAdmin,
      supabaseUser,
      supabaseUrl,
      authHeader,
      userId,
      meetingFlowState,
      identity
    );
    if (toolName === "get_meeting" && !meetingFlowState.listedIds.has(args?.meeting_id)) {
      console.log("[MEETING FLOW FINAL]", { user: userId, tool: toolName, args, corrected, action: "returned_list_instead" });
      return {
        ...recovery,
        notice: `Auto-corrected: ran list_meetings_by_source(source='${inferredSource}') first. Pick an id from \`meetings\` and retry get_meeting.`,
      };
    }
    // For analyze_meetings / search_meeting_transcripts, fall through and run the requested tool
    // now that we have a scoped list available.
  }

  switch (toolName) {
    case "fetch_plaud_meetings": {
      const res = await fetch(`${supabaseUrl}/functions/v1/fetch-plaud-meetings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({}),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to fetch Plaud meetings");
      return result;
    }

    case "list_meetings": {
      if ((args.window || args.from_date || args.to_date) && !isMyMeetingsIntent && identity?.is_admin) {
        args.scope = "all";
      }
      // Force scope default — never allow undefined to fall through
      const scope: "mine" | "all" = args.scope === "all" ? "all" : "mine";
      args.scope = scope;
      const limit = args.limit || 20;
      console.log(`[list_meetings] user=${userId} scope=${scope} args=${JSON.stringify(args)}`);

      // Use RPC to get the base scoped set (RLS-safe, deterministic ordering)
      const { data: baseRows, error: rpcErr } = await supabaseUser.rpc("get_my_meetings", {
        _limit: 500, // pull a wider set so we can filter client-side
        _scope: scope,
      });
      if (rpcErr) {
        console.error(`[list_meetings] RPC error for user=${userId}:`, rpcErr);
        throw new Error(`Failed to list meetings: ${rpcErr.message}`);
      }
      console.log(`[list_meetings] user=${userId} rpc_rows=${(baseRows || []).length}`);

      let rows = (baseRows || []) as any[];

      if (args.status) rows = rows.filter((r) => r.status === args.status);
      if (args.from_date) {
        const from = new Date(args.from_date).getTime();
        rows = rows.filter((r) => r.meeting_date && new Date(r.meeting_date).getTime() >= from);
      }
      if (args.to_date) {
        const to = new Date(`${args.to_date}T23:59:59`).getTime();
        rows = rows.filter((r) => r.meeting_date && new Date(r.meeting_date).getTime() <= to);
      }
      if (args.search) {
        const tokens = String(args.search)
          .split(/\s+/)
          .map((t) => t.replace(/[^\w]/g, "").toLowerCase())
          .filter((t) => t.length >= 4);
        const terms = tokens.length > 0 ? tokens : [String(args.search).toLowerCase()];
        rows = rows.filter((r) => {
          const hay = `${r.title || ""} ${r.transcript || ""}`.toLowerCase();
          return terms.some((t) => hay.includes(t));
        });
      }

      const sliced = rows.slice(0, limit);

      // Resolve current user's email + participant confidence to label match_reason precisely.
      let userEmail: string | null = null;
      try {
        const { data: u } = await supabaseUser.auth.getUser();
        userEmail = u?.user?.email?.toLowerCase() ?? null;
      } catch { /* ignore */ }

      const partMap = new Map<string, number>();
      if (sliced.length > 0) {
        const { data: parts } = await supabaseUser
          .from("meeting_participants")
          .select("meeting_id, match_confidence")
          .eq("user_id", userId)
          .in("meeting_id", sliced.map((r) => r.id));
        for (const p of parts || []) {
          partMap.set(p.meeting_id, Number(p.match_confidence ?? 0));
        }
      }

      const trimmed = sliced.map((r) => {
        let reason: "host" | "participant" | "email" | "unknown" = "unknown";
        let confidence = 1;
        if (r.host_user_id === userId) {
          reason = "host";
        } else if (partMap.has(r.id)) {
          reason = "participant";
          confidence = partMap.get(r.id)!;
        } else if (
          userEmail &&
          (String(r.host_email || "").toLowerCase() === userEmail ||
            (Array.isArray(r.attendee_emails) &&
              r.attendee_emails.some((e: string) => String(e || "").toLowerCase() === userEmail)))
        ) {
          reason = "email";
        }
        console.log("[MEETING MATCH]", {
          meeting_id: r.id,
          match_reason: reason,
          match_confidence: confidence,
        });
        return {
          id: r.id,
          title: r.title,
          meeting_date: r.meeting_date,
          status: r.status,
          source: r.source,
          summary: r.summary,
          participants: r.participants,
          sender_email: r.sender_email,
          created_at: r.created_at,
          match_reason: reason,
          match_confidence: confidence,
        };
      });

      // Record listed IDs so downstream get_meeting / analyze_meetings calls in this turn can be validated
      if (meetingFlowState) {
        for (const r of trimmed) meetingFlowState.listedIds.add(r.id);
      }

      const meetingFilters = { ...args, ...(resolvedMeetingWindow ? { resolved_window: resolvedMeetingWindow } : {}) };
      const meetingWindowEcho = resolvedMeetingWindow
        ? ` window=${resolvedMeetingWindow.label}[${resolvedMeetingWindow.from_date}..${resolvedMeetingWindow.to_date}] tz=${resolvedMeetingWindow.timezone}`
        : "";

      if (trimmed.length === 0) {
        let isAdmin = false;
        try {
          const { data } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" });
          isAdmin = !!data;
        } catch { /* ignore */ }

        const rr = createReadResult({
          data: [], source: "meetings_db", freshness_sla_seconds: 60, row_count: 0,
          filters_applied: meetingFilters,
          query_echo: `meetings scope=${scope}${meetingWindowEcho} limit=${limit}`,
          empty_reason: "no_matches",
        });
        console.log("[MEETING FLOW FINAL]", { user: userId, tool: "list_meetings", args, corrected, action: "no_results", isAdmin });
        return {
          count: 0,
          scope,
          empty: true,
          meetings: [],
          read_result: rr,
          meta: { readResult: true },
          message: scope === "all"
            ? "I couldn't find any meetings ingested for that date range."
            : "I couldn't find any meetings directly linked to you based on email/participant data.",
          hint: scope === "all"
            ? "The meeting database currently has no records in this window. Plaud/Gemini notes may need to be synced/imported first."
            : "Ownership requires a verified email/host/participant match. Some meetings may exist in the system but aren't attributed to you.",
          fallback_available: true,
          fallback_prompt: "Would you like me to fetch recent meeting notes from Gemini or Plaud instead? (These are not your meetings — they are unattributed source-based notes.)",
          fallback_tool: "list_meetings_by_source",
          fallback_sources: ["gemini", "plaud"],
          suggestion: isAdmin
            ? "As an admin, you can also ask me to 'show all meetings' (scope=all) to see company-wide meetings."
            : "You can confirm the fallback above, specify a date range, or ask an admin to improve participant mapping.",
          admin_recovery_available: isAdmin,
        };
      }
      const rrOk = createReadResult({
        data: trimmed, source: "meetings_db", freshness_sla_seconds: 60, row_count: trimmed.length,
        truncated: trimmed.length >= limit,
        filters_applied: meetingFilters,
        query_echo: `meetings scope=${scope}${meetingWindowEcho} limit=${limit}`,
      });
      console.log("[MEETING FLOW FINAL]", { user: userId, tool: "list_meetings", args, corrected, count: trimmed.length });
      return { count: trimmed.length, scope, meetings: trimmed, read_result: rrOk, meta: { readResult: true } };
    }

    case "list_meetings_by_source": {
      const source = args.source === "plaud" ? "plaud" : "gemini";
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
      console.log(`[list_meetings_by_source] user=${userId} source=${source} limit=${limit}`);

      let query = supabaseAdmin
        .from("meetings")
        .select("id, title, meeting_date, status, source, summary, participants, sender_email, host_email, created_at")
        .order("meeting_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(limit);

      if (source === "gemini") {
        query = query.ilike("sender_email", "%gemini-notes@google.com%");
      } else {
        query = query
          .eq("source", "plaud")
          .not("sender_email", "ilike", "%gemini-notes@google.com%");
      }

      if (args.from_date) query = query.gte("meeting_date", args.from_date);
      if (args.to_date) query = query.lte("meeting_date", `${args.to_date}T23:59:59`);

      const { data, error } = await query;
      if (error) {
        console.error(`[list_meetings_by_source] error:`, error);
        throw new Error(`Failed to list meetings by source: ${error.message}`);
      }

      const meetings = (data || []).map((r: any) => ({ ...r, match_reason: "source_fallback", match_confidence: 0 }));
      if (meetingFlowState) {
        if (!meetingFlowState.sourceFallbackIds) meetingFlowState.sourceFallbackIds = new Set<string>();
        for (const r of meetings) {
          meetingFlowState.listedIds.add(r.id);
          meetingFlowState.sourceFallbackIds.add(r.id);
        }
      }

      const sourceFilters = { source, limit, from_date: args.from_date ?? null, to_date: args.to_date ?? null, ...(resolvedMeetingWindow ? { resolved_window: resolvedMeetingWindow } : {}) };
      const sourceWindowEcho = resolvedMeetingWindow
        ? ` window=${resolvedMeetingWindow.label}[${resolvedMeetingWindow.from_date}..${resolvedMeetingWindow.to_date}] tz=${resolvedMeetingWindow.timezone}`
        : "";
      const queryEchoSrc = `meetings source=${source}${sourceWindowEcho} limit=${limit}`;
      if (meetings.length === 0) {
        const rr = createReadResult({
          data: [], source: "meetings_db", freshness_sla_seconds: 60, row_count: 0,
          filters_applied: sourceFilters, query_echo: queryEchoSrc, empty_reason: "no_matches",
        });
        return {
          count: 0, scope: "source_fallback", source, is_fallback: true, meetings: [],
          read_result: rr, meta: { readResult: true },
          disclosure: `No recent meetings ingested from ${source === "gemini" ? "Gemini (Google Meet notes)" : "Plaud"} in this window.`,
        };
      }
      const rr = createReadResult({
        data: meetings, source: "meetings_db", freshness_sla_seconds: 60, row_count: meetings.length,
        truncated: meetings.length >= limit,
        filters_applied: sourceFilters, query_echo: queryEchoSrc,
      });
      return {
        count: meetings.length,
        scope: "source_fallback",
        source,
        is_fallback: true,
        disclosure: `These are recent meetings ingested from ${source === "gemini" ? "Gemini (Google Meet notes)" : "Plaud"}. They are NOT attributed to you — ownership was not verified. Present them as fallback results and make this clear to the user.`,
        meetings,
        read_result: rr,
        meta: { readResult: true },
      };
    }

    case "get_meeting": {
      // GUARD: meeting_id must come from a prior list_meetings call in this turn.
      // AUTO-RECOVERY: instead of erroring, return the scoped list so the LLM picks a valid id.
      if (
        meetingFlowState &&
        meetingFlowState.listedIds.size > 0 &&
        !meetingFlowState.listedIds.has(args.meeting_id)
      ) {
        console.warn("[MEETING FLOW] AUTO-CORRECT get_meeting — id not in listed set", {
          user: userId,
          meeting_id: args.meeting_id,
        });
        const recovery = await executeMeetingTool(
          "list_meetings",
          { scope: "mine", limit: 5 },
          supabaseAdmin,
          supabaseUser,
          supabaseUrl,
          authHeader,
          userId,
          { listedIds: new Set(), userIntent: intent },
          identity
        );
        console.log("[MEETING FLOW FINAL]", { user: userId, tool: toolName, args, corrected: true, action: "returned_list_instead" });
        return {
          ...recovery,
          notice: "The requested meeting_id wasn't in your scoped meeting list. Pick one of these and call get_meeting again.",
        };
      }
      // Fetch source-fallback meetings with the admin client because they are intentionally
      // unattributed source results; ownership is not assumed or claimed in the response.
      const readClient = meetingFlowState?.sourceFallbackIds?.has(args.meeting_id)
        ? supabaseAdmin
        : supabaseUser;
      const { data, error } = await readClient
        .from("meetings")
        .select("*")
        .eq("id", args.meeting_id)
        .maybeSingle();
      if (error) throw new Error(`Failed to load meeting: ${error.message}`);
      if (!data) {
        const rr = createReadResult({
          data: null, source: "meetings_db", freshness_sla_seconds: 300, row_count: 0,
          filters_applied: { meeting_id: args.meeting_id },
          query_echo: `meetings get id=${args.meeting_id}`,
          empty_reason: "no_matches",
        });
        console.log("[MEETING FLOW FINAL]", { user: userId, tool: toolName, args, corrected, action: "not_found" });
        return {
          error: "Meeting not found or you do not have access to it.",
          fallback_message: "I couldn't find that meeting. Try listing your recent meetings first.",
          read_result: rr, meta: { readResult: true },
        };
      }
      const transcriptFull = data.transcript || "";
      const transcript = transcriptFull ? transcriptFull.slice(0, 40000) : null;
      const payload = { ...data, transcript };
      const rr = createReadResult({
        data: payload, source: "meetings_db", freshness_sla_seconds: 300, row_count: 1,
        truncated: !!(transcriptFull && transcriptFull.length > 40000),
        filters_applied: { meeting_id: args.meeting_id },
        query_echo: `meetings get id=${args.meeting_id}`,
      });
      return { ...payload, read_result: rr, meta: { readResult: true } };
    }

    case "get_meeting_action_items_with_context": {
      const daysBack = Math.min(30, Math.max(1, Number(args.days_back) || 7));
      // Same listed-id guard as get_meeting — auto-recover if the model invents an id.
      if (
        meetingFlowState &&
        meetingFlowState.listedIds.size > 0 &&
        !meetingFlowState.listedIds.has(args.meeting_id)
      ) {
        const recovery = await executeMeetingTool(
          "list_meetings",
          { scope: "mine", limit: 5 },
          supabaseAdmin,
          supabaseUser,
          supabaseUrl,
          authHeader,
          userId,
          { listedIds: new Set(), userIntent: intent },
          identity,
        );
        return {
          ...recovery,
          notice: "Pick a meeting_id from this list and call get_meeting_action_items_with_context again.",
        };
      }

      const readClient = meetingFlowState?.sourceFallbackIds?.has(args.meeting_id)
        ? supabaseAdmin
        : supabaseUser;
      const { data, error } = await readClient.rpc("get_action_items_around", {
        _meeting_id: args.meeting_id,
        _days_back: daysBack,
      });
      if (error) {
        console.error("[get_meeting_action_items_with_context] rpc error", error);
        return { error: error.message };
      }
      if (!data || (data as any).error) {
        return { error: (data as any)?.error || "Meeting not found or no access." };
      }
      const rr = createReadResult({
        data, source: "meetings_db", freshness_sla_seconds: 300, row_count: 1,
        filters_applied: { meeting_id: args.meeting_id, days_back: daysBack },
        query_echo: `action_items rollup meeting=${args.meeting_id} window=${daysBack}d`,
      });
      return {
        ...(data as any),
        instructions: "Present two clearly labeled sections in the answer: **From this meeting** (the focus_meeting.action_items) and **From the past " + daysBack + " days** (combined_action_items where is_focus=false, grouped by meeting_title with the meeting date). If both lists are empty, say so plainly and do not invent items.",
        read_result: rr,
        meta: { readResult: true },
      };
    }

    case "get_action_items_for_range": {
      // The window resolver above (top of executeMeetingTool) already converted
      // args.window → from_date / to_date in the caller's timezone.
      const fromDateStr: string | undefined = args.from_date;
      const toDateStr: string | undefined = args.to_date;
      if (!fromDateStr || !toDateStr) {
        return {
          error: "from_date and to_date are required (or pass a `window` value).",
        };
      }
      const fromIso = new Date(`${fromDateStr}T00:00:00`).toISOString();
      // to_date is inclusive in the tool contract; the RPC expects an exclusive upper bound.
      const toIso = new Date(new Date(`${toDateStr}T00:00:00`).getTime() + 86400000).toISOString();

      const { data, error } = await supabaseUser.rpc("get_action_items_for_range", {
        _from_date: fromIso,
        _to_date: toIso,
      });
      if (error) {
        console.error("[get_action_items_for_range] rpc error", error);
        return { error: error.message };
      }
      const payload = (data as any) || {};
      const rr = createReadResult({
        data: payload,
        source: "meetings_db",
        freshness_sla_seconds: 300,
        row_count: Number(payload.meeting_count || 0),
        filters_applied: {
          from_date: fromDateStr,
          to_date: toDateStr,
          ...(resolvedMeetingWindow ? { resolved_window: resolvedMeetingWindow } : {}),
        },
        query_echo: `action_items range [${fromDateStr}..${toDateStr}]`,
      });
      return {
        ...payload,
        instructions:
          "Aggregate the response: list every meeting in `meetings` with its title + date, then present `combined_action_items` grouped by meeting_title (with meeting_date). End with an Overall Summary covering the whole period. If `total_action_items` is 0, say so plainly and do not invent items. Do NOT discard meetings to fit a 3–5 cap when an explicit date range is in play.",
        read_result: rr,
        meta: { readResult: true },
      };
    }





    case "analyze_meetings": {
      const res = await fetch(`${supabaseUrl}/functions/v1/analyze-meeting`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(args.meeting_id ? { meeting_id: args.meeting_id } : {}),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to analyze meetings");
      return result;
    }

    case "search_meeting_transcripts": {
      const searchTerm = args.query;
      const { data, error } = await supabaseUser
        .from("meetings")
        .select("id, title, meeting_date, transcript, summary, analysis, status")
        .not("transcript", "is", null)
        .ilike("transcript", `%${searchTerm}%`)
        .order("meeting_date", { ascending: false })
        .limit(10);

      if (error) throw new Error(`Search failed: ${error.message}`);

      // Extract relevant snippets around the search term
      const results = (data || []).map((m: any) => {
        const transcript = m.transcript || "";
        const lowerTranscript = transcript.toLowerCase();
        const lowerQuery = searchTerm.toLowerCase();
        const idx = lowerTranscript.indexOf(lowerQuery);
        let snippet = "";
        if (idx >= 0) {
          const start = Math.max(0, idx - 200);
          const end = Math.min(transcript.length, idx + searchTerm.length + 200);
          snippet = (start > 0 ? "..." : "") + transcript.slice(start, end) + (end < transcript.length ? "..." : "");
        }
        return {
          id: m.id,
          title: m.title,
          meeting_date: m.meeting_date,
          status: m.status,
          summary: m.summary,
          relevant_snippet: snippet,
        };
      });

      const filters = { query: searchTerm, limit: 10 };
      const echo = `meetings transcript ilike "%${searchTerm}%" limit=10`;
      if (results.length === 0) {
        const rr = createReadResult({
          data: [], source: "meetings_db", freshness_sla_seconds: 60, row_count: 0,
          filters_applied: filters, query_echo: echo, empty_reason: "no_matches",
        });
        return { query: searchTerm, found: 0, meetings: [], read_result: rr, meta: { readResult: true } };
      }
      const rr = createReadResult({
        data: results, source: "meetings_db", freshness_sla_seconds: 60, row_count: results.length,
        truncated: results.length >= 10, filters_applied: filters, query_echo: echo,
      });
      return { query: searchTerm, found: results.length, meetings: results, read_result: rr, meta: { readResult: true } };
    }

    default:
      throw new Error(`Unknown meeting tool: ${toolName}`);
  }
}

async function executeGoogleFormsTool(toolName: string, args: any, supabaseAdmin: any): Promise<any> {
  switch (toolName) {
    case "list_google_forms": {
      const { data, error } = await supabaseAdmin
        .from("google_forms")
        .select("id, name, description, fields");
      if (error) throw new Error(`Failed to list forms: ${error.message}`);
      return (data || []).map((f: any) => {
        const fieldsList = (f.fields || []).map((field: any, idx: number) => 
          `${idx + 1}. "${field.label}" (entry_id: ${field.entry_id}, type: ${field.type}, required: ${field.required})`
        ).join("\n");
        return {
          id: f.id,
          name: f.name,
          description: f.description,
          fields: f.fields,
          field_count: (f.fields || []).length,
          field_summary: `This form has EXACTLY ${(f.fields || []).length} fields. You MUST ask these fields and ONLY these fields:\n${fieldsList}`,
        };
      });
    }
    case "submit_google_form": {
      const { data: form, error } = await supabaseAdmin
        .from("google_forms")
        .select("form_action_url, fields")
        .eq("id", args.form_id)
        .single();
      if (error || !form) throw new Error("Form not found");

      const requiredFields = (form.fields || []).filter((f: any) => f.required);
      for (const field of requiredFields) {
        if (!args.entries[field.entry_id]) {
          throw new Error(`Missing required field: ${field.label}`);
        }
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/submit-google-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formActionUrl: form.form_action_url, entries: args.entries }),
      });
      const result = await res.json();
      if (!result.success) throw new Error("Form submission failed");
      return { success: true, message: "Form submitted successfully!" };
    }
    case "parse_google_form": {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const res = await fetch(`${supabaseUrl}/functions/v1/parse-google-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formUrl: args.form_url }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to parse form (${res.status})`);
      }
      return await res.json();
    }
    case "save_parsed_google_form": {
      const { data, error } = await supabaseAdmin
        .from("google_forms")
        .insert({
          name: args.title,
          description: args.description || null,
          form_url: args.form_url,
          form_action_url: args.form_action_url,
          fields: args.fields,
        })
        .select("id, name")
        .single();
      if (error) throw new Error(`Failed to save form: ${error.message}`);
      return { success: true, id: data.id, name: data.name, message: `Form "${data.name}" saved and ready for use!` };
    }
    default:
      throw new Error(`Unknown Google Forms tool: ${toolName}`);
  }
}

async function executeNdaTool(
  toolName: string,
  args: any,
  supabaseAdmin: any,
  userId: string,
  userEmail: string,
  authHeader: string
): Promise<any> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  switch (toolName) {
    case "generate_nda": {
      // --- Pre-validation before calling nda-generate ---
      const ndaErrors: string[] = [];

      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const HAS_ALPHA_RE = /[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/;
      const MEANINGLESS_RE = /^[\d\s\W]+$/;

      // Required field presence
      const requiredFields: { key: string; label: string }[] = [
        { key: "receiving_party_name", label: "Receiving Party Name" },
        { key: "receiving_party_entity", label: "Receiving Party Entity" },
        { key: "date_of_agreement", label: "Date of Agreement" },
        { key: "registered_address", label: "Registered Address" },
        { key: "purpose", label: "Purpose" },
        { key: "recipient_name", label: "Recipient Name" },
        { key: "recipient_email", label: "Recipient Email" },
      ];

      for (const f of requiredFields) {
        const val = args[f.key];
        if (!val || (typeof val === "string" && val.trim().length === 0)) {
          ndaErrors.push(`${f.label} is required.`);
        }
      }

      // Email format validation (all email fields)
      const emailFields = [
        { key: "recipient_email", label: "Recipient Email" },
        { key: "internal_signer_email", label: "Internal Signer Email" },
      ];
      for (const f of emailFields) {
        const val = args[f.key];
        if (val && typeof val === "string" && val.trim().length > 0) {
          if (!EMAIL_RE.test(val.trim())) {
            ndaErrors.push(`${f.label} is not a valid email address.`);
          }
        }
      }

      // Name fields: must not be purely numeric
      const nameFields = [
        { key: "receiving_party_name", label: "Receiving Party Name" },
        { key: "receiving_party_entity", label: "Receiving Party Entity" },
        { key: "recipient_name", label: "Recipient Name" },
        { key: "internal_signer_name", label: "Internal Signer Name" },
      ];
      for (const f of nameFields) {
        const val = args[f.key];
        if (val && typeof val === "string" && val.trim().length > 0) {
          if (!HAS_ALPHA_RE.test(val.trim())) {
            ndaErrors.push(`${f.label} must contain alphabetic characters.`);
          }
        }
      }

      // Minimum length on key text fields
      const minLengthFields = [
        { key: "purpose", label: "Purpose", min: 5 },
        { key: "registered_address", label: "Registered Address", min: 10 },
        { key: "receiving_party_name", label: "Receiving Party Name", min: 2 },
        { key: "recipient_name", label: "Recipient Name", min: 2 },
      ];
      for (const f of minLengthFields) {
        const val = args[f.key];
        if (val && typeof val === "string" && val.trim().length > 0 && val.trim().length < f.min) {
          ndaErrors.push(`${f.label} is too short (minimum ${f.min} characters).`);
        }
      }

      // Address must not be purely numeric or meaningless
      if (args.registered_address && typeof args.registered_address === "string") {
        const addr = args.registered_address.trim();
        if (addr.length > 0 && MEANINGLESS_RE.test(addr)) {
          ndaErrors.push("Registered Address must contain meaningful text, not just numbers or symbols.");
        }
      }

      // Flexible date normalization and validation
      if (args.date_of_agreement && typeof args.date_of_agreement === "string") {
        const raw = args.date_of_agreement.trim();
        // Try to parse flexibly: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, "January 1, 2025", etc.
        let parsed: Date | null = null;

        // Try ISO format first
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          parsed = new Date(raw + "T00:00:00Z");
        }
        // DD/MM/YYYY or DD-MM-YYYY
        else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(raw)) {
          const parts = raw.split(/[\/\-]/);
          parsed = new Date(`${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}T00:00:00Z`);
        }
        // Natural language date (e.g. "January 1, 2025")
        else {
          const attempt = new Date(raw);
          if (!isNaN(attempt.getTime())) parsed = attempt;
        }

        if (!parsed || isNaN(parsed.getTime())) {
          ndaErrors.push("Date of Agreement could not be understood. Please use YYYY-MM-DD or a clear date format.");
        } else {
          // Normalize to YYYY-MM-DD for downstream
          const y = parsed.getUTCFullYear();
          const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
          const d = String(parsed.getUTCDate()).padStart(2, "0");
          args.date_of_agreement = `${y}-${m}-${d}`;
        }
      }

      if (ndaErrors.length > 0) {
        throw new Error(`NDA validation failed:\n- ${ndaErrors.join("\n- ")}`);
      }

      // --- Validation passed, proceed ---
      const res = await fetch(`${supabaseUrl}/functions/v1/nda-generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          submitter_email: userEmail,
          ...args,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "NDA generation failed");
      const downloadUrl = result.download_url || result.document_url || result.google_doc_url || result.url || null;

      // Auto-send for e-signature once the NDA is generated.
      let signatureResult: any = null;
      let signatureError: string | null = null;
      if (result.success !== false && result.submission_id) {
        try {
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const sigRes = await fetch(`${supabaseUrl}/functions/v1/nda-send-signature`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({ submission_id: result.submission_id, dry_run: false }),
          });
          const sigJson = await sigRes.json();
          if (!sigRes.ok) {
            signatureError = sigJson.error || `nda-send-signature failed (${sigRes.status})`;
          } else {
            signatureResult = sigJson;
          }
        } catch (e: any) {
          signatureError = e?.message || "Unknown error sending for signature";
        }
      }

      const sigMsg = signatureResult
        ? ` Sent for e-signature to internal signer first (envelope: ${signatureResult.envelope_id || "created"}).`
        : signatureError
          ? ` Note: auto e-signature dispatch failed — ${signatureError}. You can retry with send_nda_for_signature.`
          : "";

      return {
        ...result,
        success: result.success ?? true,
        generation_status: result.status || "generated",
        status: "success",
        download_url: downloadUrl,
        google_doc_url: result.google_doc_url || downloadUrl,
        signature: signatureResult,
        signature_error: signatureError,
        message: downloadUrl
          ? `NDA generated successfully. Download link: ${downloadUrl}.${sigMsg}`
          : (result.message || "NDA generation completed, but no download URL was returned.") + sigMsg,
      };
    }

    case "list_nda_submissions": {
      let query = supabaseAdmin
        .from("nda_submissions")
        .select("id, receiving_party_name, receiving_party_entity, date_of_agreement, recipient_name, recipient_email, status, google_doc_url, docusign_envelope_id, last_error, created_at")
        .order("created_at", { ascending: false })
        .limit(args.limit || 20);

      if (args.status) {
        query = query.eq("status", args.status);
      }

      const { data, error } = await query;
      if (error) throw new Error(`Failed to list submissions: ${error.message}`);
      return {
        count: (data || []).length,
        submissions: data || [],
      };
    }

    case "send_nda_for_signature": {
      const res = await fetch(`${supabaseUrl}/functions/v1/nda-send-signature`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          submission_id: args.submission_id,
          dry_run: args.dry_run || false,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to send for signature");
      return result;
    }

    case "send_pdf_for_signature": {
      const res = await fetch(`${supabaseUrl}/functions/v1/docusign-send-pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          staging_path: args.staging_path,
          file_name: args.file_name,
          recipient_name: args.recipient_name,
          recipient_email: args.recipient_email,
          subject: args.subject,
          message: args.message,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to send PDF for signature");
      return result;
    }

    default:
      throw new Error(`Unknown NDA tool: ${toolName}`);
  }
}


function mapTodo(t: any) {
  return {
    id: t.id,
    title: t.title,
    completed: t.completed,
    due_on: t.due_on,
    assignees: (t.assignees || []).map((a: any) => a.name),
    creator: t.creator?.name,
  };
}

function mapCard(c: any) {
  return {
    id: c.id, title: c.title, due_on: c.due_on, completed: c.completed,
    assignees: (c.assignees || []).map((a: any) => a.name),
    creator: c.creator?.name,
    description: (c.content || c.description || "").slice(0, 300),
  };
}


function getAzureStorageConfig(): { accountName: string; accountKey: string; containerName: string } | null {
  const connStr = Deno.env.get("AZURE_STORAGE_CONNECTION_STRING");
  if (!connStr) return null;
  
  const parts: Record<string, string> = {};
  for (const part of connStr.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) parts[part.slice(0, idx)] = part.slice(idx + 1);
  }
  if (!parts.AccountName || !parts.AccountKey) return null;
  return { accountName: parts.AccountName, accountKey: parts.AccountKey, containerName: "duncanstorage01" };
}

async function executeDocumentTool(
  toolName: string,
  args: any,
  supabaseUrl: string,
  authHeader: string
): Promise<any> {
  switch (toolName) {
    case "search_knowledge_base": {
      const res = await fetch(`${supabaseUrl}/functions/v1/query-knowledge-base`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ query: args.query, match_count: args.match_count ?? 8 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Knowledge base search failed");
      }
      const data = await res.json();
      const results = (data.results || []).map((r: any) => ({
        document_title: r.document_title,
        chunk_index: r.chunk_index,
        similarity: Number(r.similarity?.toFixed?.(3) ?? r.similarity),
        content: (r.content || "").slice(0, 2000),
      }));
      return {
        found: results.length,
        results,
        formatted_context: data.formatted_context || "",
        message: results.length === 0
          ? "No matching passages found in the Knowledge Base."
          : `Found ${results.length} passage(s) across ${new Set(results.map((r: any) => r.document_title)).size} document(s).`,
      };
    }

    case "search_documents": {
      const res = await fetch(`${supabaseUrl}/functions/v1/azure-blob-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ action: "search", query: args.query }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Document search failed");
      }
      const data = await res.json();
      return {
        found: data.found || 0,
        files: (data.files || []).map((f: any) => ({
          name: f.name,
          blob_path: f.name,
          size: f.size,
          lastModified: f.lastModified,
          url: f.url,
        })),
        message: (data.files || []).length === 0 
          ? "No documents found matching your query." 
          : `Found ${(data.files || []).length} document(s).`,
      };
    }

    case "read_document": {
      const blobPath = args.blob_path;
      if (!blobPath) throw new Error("blob_path is required");

      const res = await fetch(`${supabaseUrl}/functions/v1/azure-blob-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ action: "get_content", blob_path: blobPath }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to read document");
      }
      const data = await res.json();
      return {
        name: data.name,
        blob_path: data.blob_path,
        url: data.url,
        content: (data.content || "").slice(0, 40000),
      };
    }

    case "list_documents": {
      const res = await fetch(`${supabaseUrl}/functions/v1/azure-blob-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({ action: "list", path: args.path || "" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to list documents");
      }
      const data = await res.json();
      return {
        files: (data.files || []).map((f: any) => ({
          name: f.name,
          blob_path: f.name,
          size: f.size,
          lastModified: f.lastModified,
        })),
        folders: data.folders || [],
      };
    }

    default:
      throw new Error(`Unknown document tool: ${toolName}`);
  }
}

async function getCalendarAccessToken(userId: string, supabaseAdmin: any): Promise<string | null> {
  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.log("Google Calendar credentials not configured");
    return null;
  }

  const { data: tokenData, error } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !tokenData) {
    console.log("No calendar tokens found for user");
    return null;
  }

  // Check if token needs refresh
  const tokenExpiry = new Date(tokenData.token_expiry);
  if (tokenExpiry <= new Date()) {
    console.log("Token expired, refreshing...");
    
    const refreshResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenData.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!refreshResponse.ok) {
      console.error("Failed to refresh token");
      return null;
    }

    const newTokens = await refreshResponse.json();
    const newExpiry = new Date(Date.now() + (newTokens.expires_in * 1000));
    
    await supabaseAdmin
      .from("google_calendar_tokens")
      .update({
        access_token: newTokens.access_token,
        token_expiry: newExpiry.toISOString(),
      })
      .eq("user_id", userId);

    return newTokens.access_token;
  }

  return tokenData.access_token;
}

// ===== Duncan calendar identity (singleton, admin-managed) =====
async function getDuncanCalendarContext(
  supabaseAdmin: any,
): Promise<{ accessToken: string; calendarId: string } | null> {
  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const { data: tok } = await supabaseAdmin
    .from("duncan_calendar_tokens")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (!tok) return null;

  let accessToken = tok.access_token as string;
  const expiry = new Date(tok.token_expiry as string);
  if (expiry <= new Date()) {
    const r = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tok.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!r.ok) {
      console.error("[duncan-cal] refresh failed", await r.text().catch(() => ""));
      return null;
    }
    const nt = await r.json();
    accessToken = nt.access_token;
    await supabaseAdmin
      .from("duncan_calendar_tokens")
      .update({
        access_token: accessToken,
        token_expiry: new Date(Date.now() + nt.expires_in * 1000).toISOString(),
      })
      .eq("id", tok.id);
  }
  return { accessToken, calendarId: tok.calendar_id || "primary" };
}

async function auditReschedule(
  supabaseAdmin: any,
  row: {
    actor_user_id: string | null;
    tool_name: string;
    event_id?: string | null;
    source: "planner" | "google" | "unknown";
    google_event_id?: string | null;
    calendar_id?: string | null;
    requested: any;
    before_state?: any;
    after_state?: any;
    ok: boolean;
    verified: boolean;
    error?: string | null;
  },
) {
  try {
    await supabaseAdmin.from("calendar_mutation_audit").insert(row);
  } catch (e) {
    console.error("[reschedule] audit insert failed", e);
  }
}

// ===== Routing-aware reschedule executor =====
// Returns the strict contract: { ok, verified, source, before, after, error }
async function executeRescheduleTool(
  args: any,
  supabaseAdmin: any,
  actorUserId: string | null,
): Promise<any> {
  const requested = {
    event_id: args?.event_id ?? null,
    google_event_id: args?.google_event_id ?? null,
    calendar_id: args?.calendar_id ?? null,
    startDateTime: args?.startDateTime ?? null,
    endDateTime: args?.endDateTime ?? null,
    timeZone: args?.timeZone ?? null,
  };

  if (!requested.startDateTime || !requested.endDateTime) {
    const out = { ok: false, verified: false, source: "unknown", before: null, after: null, error: "startDateTime and endDateTime are required" };
    await auditReschedule(supabaseAdmin, { actor_user_id: actorUserId, tool_name: "reschedule_event", source: "unknown", requested, ok: false, verified: false, error: out.error });
    return out;
  }
  const startDate = new Date(requested.startDateTime);
  const endDate = new Date(requested.endDateTime);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
    const out = { ok: false, verified: false, source: "unknown", before: null, after: null, error: "startDateTime/endDateTime invalid or inverted" };
    await auditReschedule(supabaseAdmin, { actor_user_id: actorUserId, tool_name: "reschedule_event", source: "unknown", requested, ok: false, verified: false, error: out.error });
    return out;
  }

  // 1. Resolve the planner row when possible.
  let row: any = null;
  if (requested.event_id) {
    const { data } = await supabaseAdmin
      .from("key_events")
      .select("id, title, start_at, end_at, start_tz, calendar_id, google_event_id, all_day")
      .eq("id", requested.event_id)
      .maybeSingle();
    row = data;
  } else if (requested.google_event_id) {
    const { data } = await supabaseAdmin
      .from("key_events")
      .select("id, title, start_at, end_at, start_tz, calendar_id, google_event_id, all_day")
      .eq("google_event_id", requested.google_event_id)
      .maybeSingle();
    row = data;
  }

  const effectiveCalendarId = row?.calendar_id ?? requested.calendar_id ?? null;
  const effectiveGoogleId = row?.google_event_id ?? requested.google_event_id ?? null;
  const isLocal =
    effectiveCalendarId === "local" ||
    (typeof effectiveGoogleId === "string" && effectiveGoogleId.startsWith("local:"));

  // ==== CASE A: Local planner event — direct UPDATE on key_events ====
  if (isLocal || (row && (!effectiveGoogleId || effectiveGoogleId.startsWith("local:")))) {
    if (!row) {
      const out = { ok: false, verified: false, source: "planner", before: null, after: null, error: "Planner event not found for event_id/google_event_id" };
      await auditReschedule(supabaseAdmin, { actor_user_id: actorUserId, tool_name: "reschedule_event", source: "planner", event_id: requested.event_id, google_event_id: effectiveGoogleId, calendar_id: effectiveCalendarId, requested, ok: false, verified: false, error: out.error });
      return out;
    }
    const before = { start_at: row.start_at, end_at: row.end_at, start_tz: row.start_tz };
    const newStart = startDate.toISOString();
    const newEnd = endDate.toISOString();
    const tz = requested.timeZone || row.start_tz || "Europe/London";

    const { error: updErr } = await supabaseAdmin
      .from("key_events")
      .update({ start_at: newStart, end_at: newEnd, start_tz: tz, updated_at: new Date().toISOString() })
      .eq("id", row.id);

    if (updErr) {
      const out = { ok: false, verified: false, source: "planner", before, after: null, error: `Planner update failed: ${updErr.message}` };
      await auditReschedule(supabaseAdmin, { actor_user_id: actorUserId, tool_name: "reschedule_event", source: "planner", event_id: row.id, google_event_id: row.google_event_id, calendar_id: row.calendar_id, requested, before_state: before, ok: false, verified: false, error: out.error });
      return out;
    }

    // Re-fetch + verify
    const { data: after } = await supabaseAdmin
      .from("key_events")
      .select("start_at, end_at, start_tz")
      .eq("id", row.id)
      .maybeSingle();

    const verified =
      !!after &&
      new Date(after.start_at).getTime() === startDate.getTime() &&
      new Date(after.end_at).getTime() === endDate.getTime();

    const out = {
      ok: verified,
      verified,
      source: "planner",
      before,
      after,
      error: verified ? null : "Planner row did not reflect the requested datetimes after update",
    };
    await auditReschedule(supabaseAdmin, { actor_user_id: actorUserId, tool_name: "reschedule_event", source: "planner", event_id: row.id, google_event_id: row.google_event_id, calendar_id: row.calendar_id, requested, before_state: before, after_state: after, ok: out.ok, verified: out.verified, error: out.error });
    return out;
  }

  // ==== CASE B: Real Google Calendar event — PATCH via Duncan identity ====
  if (!effectiveGoogleId) {
    const out = { ok: false, verified: false, source: "google", before: null, after: null, error: "Missing google_event_id for non-local event" };
    await auditReschedule(supabaseAdmin, { actor_user_id: actorUserId, tool_name: "reschedule_event", source: "google", event_id: requested.event_id, calendar_id: effectiveCalendarId, requested, ok: false, verified: false, error: out.error });
    return out;
  }
  const duncan = await getDuncanCalendarContext(supabaseAdmin);
  if (!duncan) {
    const out = { ok: false, verified: false, source: "google", before: null, after: null, error: "Duncan calendar is not connected (no duncan_calendar_tokens). An admin must reconnect it." };
    await auditReschedule(supabaseAdmin, { actor_user_id: actorUserId, tool_name: "reschedule_event", source: "google", event_id: requested.event_id, google_event_id: effectiveGoogleId, calendar_id: effectiveCalendarId, requested, ok: false, verified: false, error: out.error });
    return out;
  }
  const calendarId = effectiveCalendarId || duncan.calendarId;
  const headers = { Authorization: `Bearer ${duncan.accessToken}`, "Content-Type": "application/json" };

  // GET before-state (also confirms the event actually exists on this calendar).
  const beforeResp = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(effectiveGoogleId)}`,
    { headers },
  );
  if (!beforeResp.ok) {
    const txt = await beforeResp.text().catch(() => "");
    const out = { ok: false, verified: false, source: "google", before: null, after: null, error: `Google GET ${beforeResp.status}: ${txt.slice(0, 400)}` };
    await auditReschedule(supabaseAdmin, { actor_user_id: actorUserId, tool_name: "reschedule_event", source: "google", event_id: requested.event_id, google_event_id: effectiveGoogleId, calendar_id: calendarId, requested, ok: false, verified: false, error: out.error });
    return out;
  }
  const beforeGoogle = await beforeResp.json();
  const tz = requested.timeZone || beforeGoogle?.start?.timeZone || row?.start_tz || "Europe/London";

  // PATCH — only mutate start/end/timezone; preserve everything else (attendees, conferencing, recurrence, reminders).
  const patchBody = {
    start: { dateTime: startDate.toISOString(), timeZone: tz },
    end: { dateTime: endDate.toISOString(), timeZone: tz },
  };
  const patchResp = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(effectiveGoogleId)}?sendUpdates=all`,
    { method: "PATCH", headers, body: JSON.stringify(patchBody) },
  );
  if (!patchResp.ok) {
    const txt = await patchResp.text().catch(() => "");
    const out = { ok: false, verified: false, source: "google", before: { start: beforeGoogle?.start, end: beforeGoogle?.end, updated: beforeGoogle?.updated }, after: null, error: `Google PATCH ${patchResp.status}: ${txt.slice(0, 400)}` };
    await auditReschedule(supabaseAdmin, { actor_user_id: actorUserId, tool_name: "reschedule_event", source: "google", event_id: requested.event_id, google_event_id: effectiveGoogleId, calendar_id: calendarId, requested, before_state: out.before, ok: false, verified: false, error: out.error });
    return out;
  }

  // RE-GET + verify
  const afterResp = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(effectiveGoogleId)}`,
    { headers },
  );
  const afterGoogle = afterResp.ok ? await afterResp.json() : null;
  const sameInstant = (iso: string | undefined, target: Date) =>
    !!iso && new Date(iso).getTime() === target.getTime();
  const verified =
    !!afterGoogle &&
    sameInstant(afterGoogle?.start?.dateTime, startDate) &&
    sameInstant(afterGoogle?.end?.dateTime, endDate) &&
    afterGoogle?.updated !== beforeGoogle?.updated;

  const before = { start: beforeGoogle?.start, end: beforeGoogle?.end, updated: beforeGoogle?.updated };
  const after = { start: afterGoogle?.start, end: afterGoogle?.end, updated: afterGoogle?.updated };

  const out = {
    ok: verified,
    verified,
    source: "google",
    before,
    after,
    error: verified ? null : "Google Calendar event did not reflect the requested datetimes after PATCH",
  };
  await auditReschedule(supabaseAdmin, { actor_user_id: actorUserId, tool_name: "reschedule_event", source: "google", event_id: requested.event_id, google_event_id: effectiveGoogleId, calendar_id: calendarId, requested, before_state: before, after_state: after, ok: out.ok, verified: out.verified, error: out.error });
  return out;
}



async function decryptSlackToken(encryptedToken: string, secret: string): Promise<string> {
  if (!encryptedToken.startsWith("aes-256-gcm:")) return encryptedToken;
  const [, ivPart, ciphertextPart] = encryptedToken.split(":");
  const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4)), (char) => char.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(ivPart) }, key, decode(ciphertextPart));
  return new TextDecoder().decode(plaintext);
}

async function getSlackConnection(userId: string, supabaseAdmin: any): Promise<{ accessToken: string; teamName: string | null; scope: string | null } | null> {
  const clientSecret = Deno.env.get("SLACK_CLIENT_SECRET");
  if (!clientSecret) return null;
  const { data, error } = await supabaseAdmin
    .from("slack_connections")
    .select("access_token, user_access_token, team_name, scope, user_scope")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || (!data?.access_token && !data?.user_access_token)) return null;
  const encryptedToken = data.user_access_token || data.access_token;
  return {
    accessToken: await decryptSlackToken(encryptedToken, clientSecret),
    teamName: data.team_name ?? null,
    scope: data.user_scope ?? data.scope ?? null,
  };
}

async function executeSlackTool(toolName: string, args: any, accessToken: string): Promise<any> {
  async function slackCall(method: string, params: Record<string, string | number> = {}, postBody?: Record<string, unknown>) {
    const url = new URL(`${SLACK_API_URL}/${method}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=utf-8" },
      ...(postBody ? { body: JSON.stringify(postBody) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `Slack ${method} failed`);
    return data;
  }

  switch (toolName) {
    case "list_slack_channels": {
      const channels: any[] = [];
      let cursor = "";
      do {
        const data = await slackCall("conversations.list", { limit: 200, types: "public_channel,private_channel", ...(cursor ? { cursor } : {}) });
        channels.push(...(data.channels || []));
        cursor = data.response_metadata?.next_cursor || "";
      } while (cursor && channels.length < 500);
      return channels.map((c) => ({ id: c.id, name: c.name, is_private: c.is_private, is_member: c.is_member, topic: c.topic?.value || "" }));
    }
    case "read_slack_channel_messages": {
      const limit = Math.min(Math.max(Number(args.limit || 20), 1), 50);
      const data = await slackCall("conversations.history", { channel: args.channel_id, limit });
      return (data.messages || []).map((m: any) => ({ user: m.user, text: m.text, ts: m.ts, thread_ts: m.thread_ts }));
    }
    case "send_slack_message": {
      const data = await slackCall("chat.postMessage", {}, { channel: args.channel_id, text: args.text });
      return { success: true, channel: data.channel, ts: data.ts };
    }
    default:
      throw new Error(`Unknown Slack tool: ${toolName}`);
  }
}

async function executeCalendarTool(
  toolName: string,
  args: any,
  accessToken: string,
  identity?: ResolvedIdentity,
  duncan?: { accessToken: string; calendarId: string } | null,
): Promise<any> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  // For admins with Duncan calendar connected, route WRITE operations through
  // the shared duncan@kabuni.com mailbox so invites are organised by Duncan and
  // existing Duncan-organised events can be edited.
  const writeHeaders = duncan
    ? { Authorization: `Bearer ${duncan.accessToken}`, "Content-Type": "application/json" }
    : headers;
  const writeCalendarId = duncan ? encodeURIComponent(duncan.calendarId) : "primary";

  switch (toolName) {
    case "list_calendar_events": {
      // Phase 9.4 — prefer `window` resolved in caller TZ over ad-hoc ISO inputs.
      let timeMin: string;
      let timeMax: string;
      let windowLabel: string | undefined;
      let tzUsed = identity?.timezone ?? "UTC";
      if (args.window && identity) {
        const w = resolveWindow(identity, args.window);
        timeMin = w.startISO;
        timeMax = w.endISO;
        windowLabel = w.label;
        tzUsed = w.timezone;
      } else {
        timeMin = args.timeMin || new Date().toISOString();
        timeMax = args.timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      }
      const maxResults = args.maxResults || 10;

      const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/primary/events`);
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("maxResults", String(maxResults));
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      if (identity?.timezone) url.searchParams.set("timeZone", identity.timezone);

      const filters = { timeMin, timeMax, maxResults, window: windowLabel, timezone: tzUsed };
      const queryEcho = `calendar.events?timeMin=${timeMin}&timeMax=${timeMax}&tz=${tzUsed}${windowLabel ? `&window=${windowLabel}` : ""}`;

      const response = await fetch(url.toString(), { headers });
      if (!response.ok) {
        return createReadResult({
          data: [],
          source: "google_calendar",
          freshness_sla_seconds: 60,
          row_count: 0,
          filters_applied: filters,
          query_echo: queryEcho,
          empty_reason: response.status === 401 || response.status === 403
            ? "scope_missing"
            : "upstream_error",
        });
      }
      const data = await response.json();
      const items = data.items || [];
      return createReadResult({
        data: items,
        source: "google_calendar",
        freshness_sla_seconds: 60,
        row_count: items.length,
        truncated: items.length >= maxResults,
        filters_applied: filters,
        query_echo: queryEcho,
        empty_reason: items.length === 0 ? "no_matches" : undefined,
      });
    }

    case "create_calendar_event": {
      const event = {
        summary: args.summary,
        description: args.description,
        start: { dateTime: args.startDateTime, timeZone: "UTC" },
        end: { dateTime: args.endDateTime, timeZone: "UTC" },
        location: args.location,
        attendees: args.attendees?.map((email: string) => ({ email })),
      };

      const url = `${GOOGLE_CALENDAR_API}/calendars/${writeCalendarId}/events?sendUpdates=all`;
      const response = await fetch(url, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create event: ${error}`);
      }
      const created = await response.json();
      return { ...created, _organised_by: duncan ? "duncan@kabuni.com" : "personal" };
    }

    case "update_calendar_event": {
      const { eventId, ...updates } = args;
      const event: any = {};
      if (updates.summary) event.summary = updates.summary;
      if (updates.description) event.description = updates.description;
      if (updates.startDateTime) event.start = { dateTime: updates.startDateTime, timeZone: "UTC" };
      if (updates.endDateTime) event.end = { dateTime: updates.endDateTime, timeZone: "UTC" };
      if (updates.location) event.location = updates.location;

      // Try Duncan calendar first when available (most invites are Duncan-organised),
      // fall back to personal calendar if not found there.
      const tryPatch = async (token: string, calId: string) => fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
        { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(event) },
      );

      let response: Response;
      if (duncan) {
        response = await tryPatch(duncan.accessToken, duncan.calendarId);
        if (response.status === 404 || response.status === 403) {
          response = await tryPatch(accessToken, "primary");
        }
      } else {
        response = await tryPatch(accessToken, "primary");
      }

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to update event: ${error}`);
      }
      return await response.json();
    }

    case "delete_calendar_event": {
      const tryDelete = async (token: string, calId: string) => fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(args.eventId)}?sendUpdates=all`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );

      let response: Response;
      if (duncan) {
        response = await tryDelete(duncan.accessToken, duncan.calendarId);
        if (response.status === 404 || response.status === 403) {
          response = await tryDelete(accessToken, "primary");
        }
      } else {
        response = await tryDelete(accessToken, "primary");
      }

      if (!response.ok && response.status !== 410) {
        const error = await response.text();
        throw new Error(`Failed to delete event: ${error}`);
      }
      return { success: true, message: "Event deleted successfully" };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ============================================================
// Phase 2: write-tool confirmation infrastructure
// ============================================================
const WRITE_TOOLS = new Set<string>([
  "send_gmail_email",
  "send_slack_message",
  "create_calendar_event",
  "update_calendar_event",
  "create_xero_invoice",
  "approve_xero_invoice_payment",
  "create_workstream_card",
  "update_workstream_card",
  "submit_google_form",
  "update_planner_event_meta",
  "reschedule_event",
  "send_pdf_for_signature",
]);

const WRITE_TOOL_LABELS: Record<string, string> = {
  send_gmail_email: "Send email via Gmail",
  send_slack_message: "Post message to Slack",
  create_calendar_event: "Create calendar event",
  update_calendar_event: "Update calendar event",
  create_xero_invoice: "Create Xero invoice",
  approve_xero_invoice_payment: "Approve Xero invoice payment",
  create_workstream_card: "Create workstream card",
  update_workstream_card: "Update workstream card",
  submit_google_form: "Submit Google Form",
  update_planner_event_meta: "Update planner event",
  reschedule_event: "Reschedule event (planner or Google Calendar)",
  send_pdf_for_signature: "Send PDF for e-signature (DocuSign)",
};

function summarizeWriteAction(toolName: string, args: any): string {
  const label = WRITE_TOOL_LABELS[toolName] || toolName;
  try {
    switch (toolName) {
      case "send_gmail_email":
        return `${label} to ${args?.to || "?"} — "${(args?.subject || "(no subject)").toString().slice(0, 80)}"`;
      case "send_slack_message":
        return `${label} in #${args?.channel || args?.channel_id || "?"}: "${String(args?.text || "").slice(0, 120)}"`;
      case "create_calendar_event":
        return `${label}: "${args?.summary || args?.title || "(untitled)"}" at ${args?.start || args?.start_time || "?"}`;
      case "update_calendar_event":
        return `${label} ${args?.event_id || args?.eventId || "?"}`;
      case "create_xero_invoice":
        return `${label} for ${args?.contact_name || args?.contactName || "?"} — ${args?.total || ""}`;
      case "approve_xero_invoice_payment":
        return `${label} ${args?.invoice_id || args?.invoiceId || "?"}`;
      case "create_workstream_card":
        return `${label}: "${args?.title || "(untitled)"}"`;
      case "update_workstream_card":
        return `${label} ${args?.card_id || args?.id || "?"}`;
      case "submit_google_form":
        return `${label} ${args?.form_id || args?.id || "?"}`;
      case "update_planner_event_meta":
        return `${label} ${args?.event_id || args?.id || "?"}`;
      case "reschedule_event":
        return `${label}: ${args?.event_id || args?.google_event_id || "?"} → ${args?.startDateTime || "?"} – ${args?.endDateTime || "?"}`;
      case "send_pdf_for_signature":
        return `${label}: "${args?.file_name || "PDF"}" → ${args?.recipient_name || "?"} <${args?.recipient_email || "?"}>`;
      default:
        return label;
    }
  } catch {
    return label;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Phase 2b: simple in-memory per-tool circuit breaker. After N consecutive
// failures in a single isolate, that tool is "open" (skipped) for COOLDOWN_MS.
const TOOL_FAILURES = new Map<string, { fails: number; openUntil: number }>();
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;
function circuitIsOpen(name: string): boolean {
  const s = TOOL_FAILURES.get(name);
  return !!s && s.openUntil > Date.now();
}
function recordToolFailure(name: string) {
  const s = TOOL_FAILURES.get(name) ?? { fails: 0, openUntil: 0 };
  s.fails += 1;
  if (s.fails >= CIRCUIT_THRESHOLD) {
    s.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    s.fails = 0;
  }
  TOOL_FAILURES.set(name, s);
}
function recordToolSuccess(name: string) {
  TOOL_FAILURES.delete(name);
}





serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, mode, userProfile, voiceMode, executeWriteId } = await req.json();
    const isVoiceMode = voiceMode === true;
    const CHAT_MODEL = isVoiceMode ? "gpt-4o-mini" : "gpt-4o";
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;


    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    // Get user from auth header — REQUIRE a real authenticated user.
    // Reject missing header or anon-key-only callers (getUser() returns no user for the anon key).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: missing bearer token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let userId: string | null = null;
    let userEmail: string = "";
    let calendarAccessToken: string | null = null;
    let azureStorageAvailable = false;
    
    
    let slackConnection: { accessToken: string; teamName: string | null; scope: string | null } | null = null;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: authenticated user required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    userId = user.id;
    userEmail = user.email || "";

    // Phase 9.4 — resolve canonical caller identity once per request.
    // Single source of truth for timezone, working hours, manager, admin flag.
    // Used by system prompt, calendar/workstream window math, and (soon) every read tool.
    const identityCache = new IdentityCache();
    let resolvedIdentity: ResolvedIdentity;
    try {
      resolvedIdentity = await resolveIdentity(supabaseAdmin, userId, identityCache);
    } catch (e) {
      console.warn("[identity] resolve failed, using fallback:", e);
      resolvedIdentity = await resolveIdentity(supabaseAdmin, userId, identityCache).catch(() => ({
        user_id: userId,
        profile_id: null,
        email: userEmail || null,
        display_name: null,
        department: null,
        role_title: null,
        timezone: "Europe/London",
        working_hours: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
        manager_id: null,
        is_admin: false,
        source: "fallback" as const,
        resolved_at: new Date().toISOString(),
      }));
    }

    // Phase 1.5: parallelize pre-LLM warm-up (integrations + forms) instead of sequential awaits.
    const [
      calendarTokenResult,
      slackResult,
      formsResult,
      duncanCalendarResult,
    ] = await Promise.all([
      getCalendarAccessToken(userId, supabaseAdmin).catch((e) => { console.warn("[warmup] calendar:", e); return null; }),
      getSlackConnection(userId, supabaseAdmin).catch((e) => { console.warn("[warmup] slack:", e); return null; }),
      supabaseAdmin.from("google_forms").select("id, name, description, fields"),
      // Admins write calendar invites through the shared duncan@kabuni.com mailbox.
      resolvedIdentity.is_admin
        ? getDuncanCalendarContext(supabaseAdmin).catch((e) => { console.warn("[warmup] duncan-cal:", e); return null; })
        : Promise.resolve(null),
    ]);
    calendarAccessToken = calendarTokenResult;
    slackConnection = slackResult;
    azureStorageAvailable = !!getAzureStorageConfig();
    const googleForms = formsResult?.data;
    const duncanCalendar = duncanCalendarResult;


    // Adjust system prompt based on mode and integration availability
    // Phase 9.4 — inject canonical identity block (incl. local "now" in caller TZ).
    // Keep UTC line too so existing prompt patterns that key off "Current date and time" still match.
    let systemContent = SYSTEM_PROMPT
      + `\n\nCurrent date and time: ${new Date().toISOString()} (UTC).`
      + `\n\n## CALLER IDENTITY (canonical — use these for "today", "this week", "my time")\n`
      + formatIdentityForPrompt(resolvedIdentity)
      + `\n\nWhen the user says "today" / "tomorrow" / "this week", interpret them in the caller's timezone above, NOT UTC.`;

    // Always inject available forms into the system prompt so the model has field data across all turns
    if (googleForms && googleForms.length > 0) {
      let formsContext = "\n\n## AVAILABLE GOOGLE FORMS (PRE-LOADED — DO NOT CALL list_google_forms)\nThe following forms are available. Use ONLY these exact fields when asking questions:\n";
      for (const form of googleForms) {
        formsContext += `\n### Form: "${form.name}" (ID: ${form.id})\n`;
        if (form.description) formsContext += `Description: ${form.description}\n`;
        formsContext += `Fields (ask ONLY these, in this order):\n`;
        const fields = form.fields as any[];
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          formsContext += `  ${i + 1}. Label: "${f.label}" | entry_id: ${f.entry_id} | type: ${f.type} | required: ${f.required}${f.options ? ` | options: ${f.options.join(", ")}` : ""}\n`;
        }
        formsContext += `Total fields: ${fields.length}. Ask exactly ${fields.length} questions — no more, no less.\n`;
      }
      systemContent += formsContext;
    }

    if (!calendarAccessToken) {
      systemContent += "\n\nNote: Google Calendar is not connected for you. If the user asks about calendar operations, let them know they need to connect their Google Calendar first via the Integrations page.";
    }

    if (!azureStorageAvailable) {
      systemContent += "\n\nNote: Document storage is not configured. If the user asks about documents or company files, let them know the document storage system needs to be configured first.";
    }




    if (slackConnection) {
      systemContent += `\n\nSlack is connected for this user${slackConnection.teamName ? ` to ${slackConnection.teamName}` : ""}. Use Slack tools when the user asks about Slack messages, channels, or team signals.`;
    } else {
      systemContent += "\n\nNote: Slack is not connected for this user. If the user asks about Slack, let them know they need to connect Slack first via the Integrations page.";
    }

    // Inject user profile context if available
    if (userProfile) {
      const parts: string[] = [];
      if (userProfile.display_name) parts.push(`Name: ${userProfile.display_name}`);
      if (userProfile.role_title) parts.push(`Role: ${userProfile.role_title}`);
      if (userProfile.department) parts.push(`Department: ${userProfile.department}`);
      if (userProfile.bio) parts.push(`About: ${userProfile.bio}`);
      if (userProfile.norman_context) parts.push(`Additional context: ${userProfile.norman_context}`);
      if (parts.length > 0) {
        systemContent += `\n\nYou are speaking with a team member. Here is their profile:\n${parts.join("\n")}\n\nUse this information to personalise your responses. Address them by name when appropriate.`;
      }
    }

    // CEO MODE — Nimesh-only prompt layer
    const CEO_EMAIL = "nimesh@kabuni.com";
    if (userEmail.toLowerCase() === CEO_EMAIL) {
      systemContent += `

## CEO OPERATING MODE (ACTIVE)
You are speaking with Nimesh Patel, CEO of Kabuni. Switch to executive decision-engine mode.

NON-NEGOTIABLE 2026 PRIORITIES (ground every analysis here):
1. Lightning Strike India — 7 June 2026
2. 1M Kabuni Premier League registrations
3. Trials October & November 2026
4. Final 10-team selection December (10 Super Coaches)
5. 100,000 pre-orders
6. Duncan automates 25% of the company

If activity does not move one of these, it is secondary unless it removes a major risk.

ORG MAP (enforce ownership in every answer):
Nimesh = CEO · Patrick = CFO · Ellaine = COO/CLO · Matt = CPO · Alex = CMO · Simon = Operations Director · Palash = Head of Duncan · Parmy = CTO

ESCALATION:
Strategic→CEO · Financial→CFO · Execution→COO · Product→CPO · Growth→CMO · Tech→CTO · Automation→Head of Duncan. Cross-functional risks → flag and escalate to CEO.

BEHAVIOURAL RULES:
- Truth Over Narrative: data reality wins; call out conflicts.
- Illusion Detection: name activity that masquerades as progress (meetings replacing decisions, momentum without conversion).
- Pattern Recognition: compare today vs prior days; flag worsening or improving trends.
- Pressure Rule: if drifting, increase urgency; never normalise underperformance.
- Scoring contract: when asked about any workstream, return Progress / Confidence / Risk (0–100) with evidence.
- If data is weak → LOWER confidence and say so explicitly.
- Be brutally direct. The CEO needs truth, not comfort. Skip pleasantries.

ANALYTICAL FRAMEWORK (apply to every workstream you discuss):
1. Progress vs company goals  2. Execution quality  3. Risk exposure  4. Commercial impact  5. Dependency strength  6. Cross-functional alignment

FINAL INSTRUCTION — every CEO answer must help him answer:
- Are we on track?  - What will break?  - Where must I act?

Close every substantive answer with a one-line footer in this exact shape:
\`On track: <one phrase> · Will break: <one phrase> · Act: <one phrase>\`

For full structured briefings (morning/evening), point Nimesh to the dedicated /ceo dashboard.`;
    }

    // Inject user's Gmail writing-style profile if it exists
    if (userId) {
      const { data: writingProfile } = await supabaseAdmin
        .from("gmail_writing_profiles")
        .select("style_summary, common_phrases, sample_replies")
        .eq("user_id", userId)
        .maybeSingle();
      if (writingProfile && writingProfile.style_summary) {
        systemContent += `\n\n## USER'S EMAIL WRITING STYLE (mimic this when drafting emails)\n${writingProfile.style_summary}\n\nCommon phrases this user uses:\n${JSON.stringify(writingProfile.common_phrases, null, 2)}\n\nWhen using draft_gmail_reply or draft_gmail_email, write in THIS style. Override the generic email composition rules ONLY where they conflict with the user's natural voice. The drafts go to Gmail Drafts — never auto-sent — so prioritise sounding like the user over generic professionalism.`;
      }
    }

    if (mode === "briefing") {
      systemContent += `\n\nYou are generating a personalized briefing for ${userProfile?.display_name || "a team member"}. The briefing data includes a "since" field indicating when the last briefing was generated, and an "is_first_briefing" flag.

**IMPORTANT CONTEXT**: If "since" is set, this is a CHECK-IN UPDATE — only highlight what has CHANGED or is NEW since that timestamp. Frame it as "Since your last check-in at [time]..." and focus on deltas. If "is_first_briefing" is true, give a full overview.

Present a warm, concise briefing covering these sections IN THIS EXACT ORDER (skip a section ONLY if its data is truly empty — but ALWAYS include section 5 if token_usage data is present):

1. 📅 **Today's Calendar** — Upcoming events/meetings scheduled for today
2. 📋 **Meetings & Action Items** — New meeting summaries and action items assigned to this user
3. 💼 **Project Updates** — Changes to their Azure DevOps work items
4. 📊 **Workstreams** — Cards assigned to this user (with status, priority, due dates) and incomplete tasks assigned to them. Highlight overdue or urgent items.
5. 📈 **Your AI Usage Today** — REQUIRED FOOTER. Show the user's today's \`token_usage.my_today.total_tokens\` and \`request_count\` in one line, then list the top-3 from \`token_usage.leaderboard\` (last 30 days) as a compact ranked list (e.g. "🥇 Name — 12,345 tokens"). Keep this section to 2–3 lines max, presented as a light footer at the very bottom of the briefing. Do NOT omit this section.

Format as a natural, readable summary with clear sections. If a section has no data, briefly note "No updates since last check-in" for that area. Keep it actionable and concise. Address the user by name. Highlight anything urgent (overdue items, items due today). For returning check-ins, emphasize what's new or changed.`;
    } else if (mode === "reason") {
      systemContent += "\n\nYou are in REASONING mode. Think deeply and step-by-step. Show your reasoning chain explicitly using numbered steps. Consider multiple angles before concluding.";
    } else if (mode === "automate") {
      systemContent += "\n\nYou are in AUTOMATION mode. Focus on creating actionable automation plans. For each step, specify: the trigger, the action, the target system, and expected outcome. Format as a clear workflow.";
    } else if (mode === "analyze") {
      systemContent += "\n\nYou are in ANALYSIS mode. Focus on data patterns, trends, and insights. Use structured formats like tables and comparisons. Quantify findings when possible.";
    }

    if (isVoiceMode) {
      systemContent += "\n\nYou are responding via VOICE. Reply in 1–3 short sentences, conversational tone, no markdown, no lists, no headings, no tables. If you used tools, summarize the results aloud — do not read raw data, IDs, or URLs. Speak naturally, like a colleague on a call.";
    }

    const SIMPLE_INPUT_PATTERNS = [/^hi[!.?\s]*$/i, /^hello[!.?\s]*$/i, /^how are you[?.!\s]*$/i];

    function extractPlainText(content: unknown): string {
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map((part: any) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
          .join(" ")
          .trim();
      }
      return "";
    }

    const latestUserMessage = [...messages].reverse().find((message: any) => message?.role === "user");
    const latestUserText = extractPlainText(latestUserMessage?.content).trim();

    const recentConversationText = messages
      .slice(-12)
      .map((m: any) => typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? ""))
      .join("\n");

    function cleanNdaFieldValue(value: string | null | undefined): string | undefined {
      if (!value) return undefined;
      const cleaned = value
        .replace(/^[-*\s]+/, "")
        .replace(/\s+$/g, "")
        .replace(/["'`]+$/g, "")
        .trim();
      return cleaned.length > 0 ? cleaned : undefined;
    }

    function readNdaLabel(text: string, labels: string[]): string | undefined {
      for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[:：]\\s*([^\\n]+)`, "i");
        const match = text.match(re);
        const value = cleanNdaFieldValue(match?.[1]);
        if (value) return value;
      }
      return undefined;
    }

    function extractNdaArgsFromConversation(text: string): Record<string, any> | null {
      const normalizedFromJson = (() => {
        try {
          const marker = text.lastIndexOf('"tool_name":"generate_nda"');
          const spacedMarker = marker >= 0 ? marker : text.lastIndexOf('"tool_name": "generate_nda"');
          if (spacedMarker >= 0) {
            const start = text.lastIndexOf("{", spacedMarker);
            const end = text.indexOf("}", spacedMarker);
            if (start >= 0 && end > start) {
              const parsed = JSON.parse(repairJsonCandidate(text.slice(start, end + 1)));
              const { tool_name: _toolName, toolName: _toolName2, name: _name, ...rest } = parsed;
              return rest;
            }
          }
        } catch { /* fall through to markdown label extraction */ }
        return null;
      })();

      const args: Record<string, any> = normalizedFromJson && typeof normalizedFromJson === "object"
        ? { ...normalizedFromJson }
        : {};

      args.receiving_party_name ??= readNdaLabel(text, ["Receiving Party Name", "Receiving Party"]);
      args.receiving_party_entity ??= args.receiving_party_legal_entity_name ?? readNdaLabel(text, ["Receiving Party Legal Entity", "Receiving Party Legal Entity Name", "Legal Entity", "Legal Entity Name"]);
      args.date_of_agreement ??= readNdaLabel(text, ["Date of Agreement", "Agreement Date"]);
      args.registered_address ??= readNdaLabel(text, ["Registered Address", "Registered Address of the Receiving Party Legal Entity"]);
      args.purpose ??= readNdaLabel(text, ["Purpose", "Purpose of the NDA", "NDA Purpose"]);
      args.recipient_name ??= readNdaLabel(text, ["Recipient Name", "Recipient Name for Signature", "Signer Name"]);
      args.recipient_email ??= readNdaLabel(text, ["Recipient Email", "Recipient Email for Signature", "Signer Email"]);
      args.internal_signer_name ??= readNdaLabel(text, ["Internal Signer Name"]);
      args.internal_signer_email ??= readNdaLabel(text, ["Internal Signer Email"]);

      if (!args.internal_signer_name) args.internal_signer_name = "Palash Soundarkar";
      if (!args.internal_signer_email) args.internal_signer_email = "palash@kabuni.com";

      const required = ["receiving_party_name", "receiving_party_entity", "date_of_agreement", "registered_address", "purpose", "recipient_name", "recipient_email"];
      const complete = required.every((key) => typeof args[key] === "string" && args[key].trim().length > 0);
      return complete ? args : null;
    }

    function looksLikeNdaGenerationPromise(text: string): boolean {
      return /\bNDA\b/i.test(text) &&
        /\bgenerating\b|\bgenerate(?:d|ing)?\b/i.test(text) &&
        /download link|as soon as|once (?:the document is )?ready|share (?:the )?link/i.test(text);
    }

    const pendingNdaArgsFromHistory = extractNdaArgsFromConversation(recentConversationText);

    // Phase 5: raise the tool-call ceiling to 6 rounds so multi-step
    // operational sequences (resolve entity → list → fetch detail → mutate →
    // re-verify → narrate) can complete in a single turn without the loop
    // tripping the cap mid-task. The 90s wall-clock budget is the real
    // upper bound and prevents runaway loops.
    const MAX_TOOL_ROUNDS = 6;
    const MAX_EXECUTION_TIME_MS = 90_000;
    // Broad: any user message mentioning meetings/calls + an intent verb (fetch/get/show/give/what)
    // OR meeting-notes/summary/discussions phrasing — triggers source disambiguation.
    const SOURCE_AMBIGUOUS_MEETING_RE = /\b(meeting|meetings|call|calls)\b.*\b(notes?|summary|summaries|discussion|discussions|recording|recordings|transcript|transcripts)\b|\b(fetch|get|show|give\s+me|grab|pull|what\s+were|what\s+did|what\s+meetings)\b.*\b(meeting|meetings|call|calls)\b|\b(my\s+)?(latest|recent|last|today'?s|yesterday'?s|this\s+week'?s)\s+(meeting|meetings|call|calls)\b/i;
    const MEETING_SOURCE_MENTIONED_RE = /\b(gemini|google\s*meet|google-meet|googlemeet|gemini-?notes|plaud)\b/i;
    // Treat "meetings I attended/hosted" the same as other meeting requests — still ask source first.
    const EXPLICIT_OWNERSHIP_MEETING_RE = /__never_match__/i;

    // Check whether the user has ALREADY chosen a source earlier in this conversation.
    // If so, the disambiguation has been satisfied — do not re-trigger the override on
    // follow-up messages like "Full Notes" or "Paste it here".
    const RECENT_TURN_WINDOW = 8;
    const recentMessages = messages.slice(-RECENT_TURN_WINDOW);
    const recentPriorUserMessages = recentMessages.filter((m: any) => m?.role === "user" && m !== latestUserMessage);
    const sourceAlreadyChosen = recentMessages.some((m: any) => {
      if (m?.role !== "user") return false;
      const txt = extractPlainText(m?.content);
      return MEETING_SOURCE_MENTIONED_RE.test(txt);
    });
    const sourceChosenForPendingMeeting =
      MEETING_SOURCE_MENTIONED_RE.test(latestUserText) &&
      recentPriorUserMessages.some((m: any) => SOURCE_AMBIGUOUS_MEETING_RE.test(extractPlainText(m?.content)));

    const mustAskMeetingSource =
      SOURCE_AMBIGUOUS_MEETING_RE.test(latestUserText) &&
      !MEETING_SOURCE_MENTIONED_RE.test(latestUserText) &&
      !EXPLICIT_OWNERSHIP_MEETING_RE.test(latestUserText) &&
      !sourceAlreadyChosen;
    const explicitSourceMeetingRequest =
      SOURCE_AMBIGUOUS_MEETING_RE.test(latestUserText) &&
      MEETING_SOURCE_MENTIONED_RE.test(latestUserText) &&
      !EXPLICIT_OWNERSHIP_MEETING_RE.test(latestUserText);

    const buildTextSseResponse = (content: string) => {
      const payload = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(payload, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    };

    // ===== Personal Gmail token resolver (for the calling user) =====
    const getUserGmailAccessToken = async (uid: string): Promise<{ accessToken: string; emailAddress: string | null } | null> => {
      const { data: tokenRow } = await supabaseAdmin
        .from("gmail_tokens")
        .select("*")
        .eq("connected_by", uid)
        .maybeSingle();
      if (!tokenRow) return null;

      const expiry = new Date(tokenRow.token_expiry);
      if (expiry.getTime() - Date.now() < 5 * 60 * 1000) {
        const clientId = Deno.env.get("GMAIL_CLIENT_ID")!;
        const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: tokenRow.refresh_token,
            grant_type: "refresh_token",
          }),
        });
        if (!res.ok) return null;
        const refreshed = await res.json();
        const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000);
        await supabaseAdmin
          .from("gmail_tokens")
          .update({ access_token: refreshed.access_token, token_expiry: newExpiry.toISOString() })
          .eq("id", tokenRow.id);
        return { accessToken: refreshed.access_token, emailAddress: tokenRow.email_address };
      }
      return { accessToken: tokenRow.access_token, emailAddress: tokenRow.email_address };
    };

    const decodeBase64Url = (b64: string): string => {
      try {
        const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
        const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
        const bin = atob(padded);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder("utf-8").decode(bytes);
      } catch { return ""; }
    };

    const extractPlainBodyFromGmailPayload = (payload: any): string => {
      if (!payload) return "";
      // Prefer text/plain
      const walk = (part: any, mime: string): string => {
        if (!part) return "";
        if (part.mimeType === mime && part.body?.data) return decodeBase64Url(part.body.data);
        if (Array.isArray(part.parts)) {
          for (const p of part.parts) {
            const found = walk(p, mime);
            if (found) return found;
          }
        }
        return "";
      };
      let text = walk(payload, "text/plain");
      if (!text) {
        const html = walk(payload, "text/html");
        if (html) text = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
      }
      if (!text && payload.body?.data) text = decodeBase64Url(payload.body.data);
      return text.trim();
    };

    const stripGeminiBoilerplate = (notes: string): string => {
      let out = notes;
      const footerPatterns = [
        /\n\s*Meeting records\s+Document\s+Notes by Gemini[\s\S]*$/i,
        /\n\s*Is the ['"]?Next steps['"]? section in this email helpful\?[\s\S]*$/i,
        /\n\s*Google LLC,[\s\S]*$/i,
        /\n\s*You have received this email because[\s\S]*$/i,
        /\n\s*The content was auto-generated[^\n]*\n?/i,
        /\n\s*These notes have been sent to[^\n]*\n?/i,
        /\n\s*Open meeting notes\s*\n?/i,
        /^\s*Notes from ['"][^'"]+['"]\s*\n?/im,
      ];
      for (const re of footerPatterns) out = out.replace(re, "").trim();
      return out;
    };

    const fetchLatestGeminiNotesFromUserGmail = async (uid: string): Promise<string> => {
      const tok = await getUserGmailAccessToken(uid);
      if (!tok) {
        return `Your personal Gmail isn't connected yet, so I can't pull your Google Meet (Gemini) notes. Connect Gmail in Settings → Integrations and try again.`;
      }
      const headers = { Authorization: `Bearer ${tok.accessToken}` };
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=${encodeURIComponent("from:gemini-notes@google.com")}`,
        { headers },
      );
      if (!listRes.ok) {
        const err = await listRes.text();
        return `I couldn't reach your Gmail to fetch the latest Google Meet notes (${listRes.status}). ${err.slice(0, 200)}`;
      }
      const listJson = await listRes.json();
      const msgId = listJson?.messages?.[0]?.id;
      if (!msgId) {
        return `I checked your Gmail (${tok.emailAddress || "your inbox"}) and didn't find any messages from gemini-notes@google.com.`;
      }
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
        { headers },
      );
      if (!msgRes.ok) {
        return `I found a Google Meet notes email but couldn't read it (${msgRes.status}).`;
      }
      const msg = await msgRes.json();
      const hdrs: any[] = msg?.payload?.headers || [];
      const getH = (name: string) => hdrs.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
      const subject = getH("Subject") || "Latest Google Meet notes";
      const dateRaw = getH("Date");
      const date = dateRaw ? new Date(dateRaw).toLocaleString("en-GB", { timeZone: "Europe/London" }) : "Date unavailable";
      let body = extractPlainBodyFromGmailPayload(msg?.payload);
      body = stripGeminiBoilerplate(body) || "No notes content was found in this email.";

      return `## ${subject}\n\n- **Date:** ${date}\n- **Source:** Google Meet (from your Gmail: ${tok.emailAddress || "you"})\n\n${body.slice(0, 40000)}`;
    };

    const formatLatestSourceMeetingNotes = async (source: "gemini" | "plaud") => {
      if (source === "gemini") {
        return await fetchLatestGeminiNotesFromUserGmail(userId);
      }
      // Plaud: keep DB-based fetch (Plaud notes are ingested centrally)
      const { data, error } = await supabaseAdmin
        .from("meetings")
        .select("id, title, meeting_date, status, source, sender_email, summary, transcript, analysis, created_at")
        .eq("source", "plaud")
        .not("sender_email", "ilike", "%gemini-notes@google.com%")
        .order("meeting_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw new Error(`Failed to fetch latest Plaud meeting notes: ${error.message}`);
      const meeting = Array.isArray(data) ? data[0] : null;
      if (!meeting) return `I couldn't find any recent Plaud meeting notes.`;
      const date = meeting.meeting_date ? new Date(meeting.meeting_date).toLocaleString("en-GB", { timeZone: "Europe/London" }) : "Date unavailable";
      const analysis = meeting.analysis && typeof meeting.analysis === "object" ? meeting.analysis : null;
      const notes = String(meeting.transcript || meeting.summary || analysis?.summary || "").trim();
      const body = notes || "No transcript or notes content is available for this meeting yet.";
      return `## ${meeting.title?.trim() || "Latest meeting notes"}\n\n- **Date:** ${date}\n- **Source:** Plaud\n\n${body.slice(0, 40000)}`;
    };

    if (sourceChosenForPendingMeeting || explicitSourceMeetingRequest) {
      const selectedSource: "gemini" | "plaud" = /plaud/i.test(latestUserText) ? "plaud" : "gemini";
      const rawContent = await formatLatestSourceMeetingNotes(selectedSource);

      // If the helper returned a soft error (no Gmail connected, no messages, etc.),
      // surface it directly without sending to the LLM.
      const isErrorMessage = /^(Your personal Gmail|I checked your Gmail|I couldn't|I found a Google Meet)/i.test(rawContent);
      if (isErrorMessage) return buildTextSseResponse(rawContent);

      const formattingSystem = selectedSource === "gemini"
        ? `You are Duncan reformatting a raw Google Meet (Gemini) notes email into a clean, executive-ready briefing. STRICT RULES:
- Preserve EVERY piece of substantive content — attendees, summary, discussion points, decisions, action items, owners, dates, times, links. Do NOT drop or paraphrase facts.
- Remove ONLY noise: email signatures, "Open meeting notes" buttons, feedback prompts, Google LLC footers, repeated headings, raw URLs that duplicate link text, tracking junk.
- Output structure (use these exact section headings, omit a section only if truly empty):
  ## {Meeting title}
  - **Date:** ...
  - **Source:** Google Meet
  ### Attendees
  ### Summary
  ### Discussion
  ### Decisions
  ### Action Items
    - [ ] **Owner** — task (due date if given)
  ### Next Steps
- Use Markdown bullets, bold for owners/labels, and tight spacing. No preamble, no closing remarks. Begin directly with the H2 title.`
        : `You are Duncan reformatting raw Plaud meeting notes into a clean, executive-ready briefing. Preserve all substantive content, remove transcription noise, and use the same Markdown structure (## title, Date, Source, Attendees, Summary, Discussion, Decisions, Action Items, Next Steps). Begin directly with the H2 title.`;

      const formattingResponse = await fetchAIWithRetry({
        messages: [
          { role: "system", content: formattingSystem },
          { role: "user", content: `Reformat the following meeting notes. Keep all facts, names, owners, dates and action items intact:\n\n${rawContent}` },
        ],
        temperature: 0.2,
      });
      if (!formattingResponse.ok || !formattingResponse.body) {
        return buildTextSseResponse(rawContent);
      }
      return new Response(formattingResponse.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // Persistent across all tool-call iterations in this request — tracks meeting IDs the LLM has actually been shown
    const meetingFlowState = { listedIds: new Set<string>(), sourceFallbackIds: new Set<string>(), userIntent: latestUserText };
    let shouldBypassTools =
      latestUserText.length > 0 &&
      !sourceChosenForPendingMeeting &&
      !MEETING_SOURCE_MENTIONED_RE.test(latestUserText) &&
      (latestUserText.length < 20 || SIMPLE_INPUT_PATTERNS.some((pattern) => pattern.test(latestUserText)));
    const isNdaConfirmationReply = (() => {
      const normalized = latestUserText.trim().toLowerCase().replace(/[.!?]+$/g, "");
      const isAffirmative = /^(yes|y|yeah|yep|ok|okay|sure|confirmed|confirm|go|go ahead|please do|do it)$/i.test(normalized);
      if (!isAffirmative) return false;
      if (/##\s*NDA generated|\[Download NDA\]\(/i.test(recentConversationText)) return false;
      return /\bNDA\b|generate_nda/i.test(recentConversationText) &&
        /Receiving Party|Legal Entity|registered address|recipient email|NDA details captured|ready to generate|Generating the NDA|NDA — Summary/i.test(recentConversationText);
    })();
    if (isNdaConfirmationReply) {
      shouldBypassTools = false;
      systemContent += `\n\n## CURRENT REQUEST OVERRIDE — NDA CONFIRMATION\nThe latest user reply is confirming a pending NDA generation. Do not answer with a promise. Immediately call \`generate_nda\` using the confirmed NDA fields from the conversation history. After the tool returns, share the actual download link from the tool result.`;
    }

    if (isNdaConfirmationReply && pendingNdaArgsFromHistory) {
      try {
        const result = await executeNdaTool("generate_nda", pendingNdaArgsFromHistory, supabaseAdmin, userId, userEmail, authHeader);
        const downloadUrl = result?.download_url || result?.google_doc_url || result?.document_url;
        const content = downloadUrl
          ? `## NDA generated\n\n[Download NDA](${downloadUrl})`
          : `## NDA generated\n\nThe document was generated, but no download link was returned. Please ask me to list NDA submissions and I’ll retrieve it.`;
        return buildTextSseResponse(content);
      } catch (error: any) {
        return buildTextSseResponse(`## NDA generation failed\n\n${error?.message || "Unknown error"}`);
      }
    }

    // ── Lightweight entity resolver ─────────────────────────────────────────
    // Fuzzy-match the user message against known enum/source values BEFORE the
    // model generates. When we find a confident hit we inject a small block so
    // the model executes immediately instead of inventing alternative systems.
    try {
      const lower = latestUserText.toLowerCase();
      const PROJECT_TAGS = ["Lightning Strike Event", "Website", "K10 App", "School Integrations"];
      const tagAliases: Record<string, string[]> = {
        "Lightning Strike Event": ["lightning strike", "lightning-strike", "lightningstrike", "lightning strike event", "lightning"],
        "Website": ["website", "site", "web site"],
        "K10 App": ["k10", "k10 app", "k-10", "k 10 app"],
        "School Integrations": ["school integrations", "school integration", "schools integration"],
      };
      const matchedTag = PROJECT_TAGS.find((tag) =>
        (tagAliases[tag] || []).some((a) => lower.includes(a))
      );
      const READ_INTENT_RE = /\b(list|show|open|all|view|see|fetch|get|pull|display|enumerate|what'?s|whats|summari[sz]e|summary|cards?|tasks?|to[- ]?dos?|pending|overdue|on my plate|active|outstanding|in progress)\b/i;
      const isReadIntent = READ_INTENT_RE.test(latestUserText);
      const resolverBlocks: string[] = [];
      if (matchedTag && isReadIntent) {
        resolverBlocks.push(
          `## RESOLVED ENTITY (pre-computed — DO NOT ask for clarification)\n` +
          `- project_tag: "${matchedTag}" (matched from the user's message)\n` +
          `- canonical source: Workstreams (workstream_cards table)\n` +
          `- confidence: high\n` +
          `- required action: call \`list_workstream_cards\` with { project_tag: "${matchedTag}", status: "open" } immediately. Do NOT ask the user which system to pull from. Basecamp/Trello/Jira/Asana/Monday/Notion-tasks are NOT connected and must not be offered.`
        );
      }
      if (resolverBlocks.length > 0) {
        systemContent += `\n\n` + resolverBlocks.join("\n\n");
      }
    } catch (_resolverErr) {
      // Non-fatal — resolver is a best-effort pre-pass.
    }


    // ================================================================
    // Phase 4: classifyTurn — single deterministic router.
    // Collapses the previously scattered defensive layers
    // (mustAskMeetingSource, shouldBypassTools, INTENT_RULES,
    // inline entity resolver) into ONE canonical readout.
    // Downstream code reads `turn.*` instead of the individual flags;
    // the original locals are kept as aliases for backward compat so
    // the rest of this function remains untouched.
    // ================================================================
    const turn = {
      latestUserText,
      isVoiceMode,
      // intent signals
      isDataIntent: false as boolean,           // filled below
      intentMatched: false as boolean,          // filled below
      // disambiguation
      needsMeetingSourceClarification: mustAskMeetingSource,
      explicitSourceMeetingRequest,
      sourceAlreadyChosen,
      // execution gates
      bypassTools: false as boolean,            // filled below
      // pre-resolved entities (deterministic, high-confidence)
      resolvedProjectTag: null as string | null, // filled below
    };

    // Phase 5: working-memory injection — surface any pending writes the
    // user has queued in the last few minutes so the model never claims
    // a write succeeded when it is actually awaiting confirmation, and
    // can refer back to recent verified writes by id when asked.
    try {
      if (userId) {
        const sinceIso = new Date(Date.now() - 10 * 60_000).toISOString();
        const { data: pendingRows } = await supabaseAdmin
          .from("chat_write_pending")
          .select("id, tool_name, summary, status, created_at, executed_at, result")
          .eq("user_id", userId)
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(5);
        if (pendingRows && pendingRows.length > 0) {
          const lines = pendingRows.map((r: any) => {
            const env = r.result || {};
            const verified = env.ok === true && env.verified === true;
            const tail =
              r.status === "executed" && verified
                ? `verified=true (source=${env.source ?? "?"})`
                : r.status === "failed"
                ? `failed: ${(env.error || r.error || "unknown").toString().slice(0, 120)}`
                : `status=${r.status}`;
            return `- [${r.id.slice(0, 8)}] ${r.tool_name} — ${r.summary ?? "(no summary)"} — ${tail}`;
          });
          systemContent +=
            `\n\n## WORKING MEMORY — recent write actions (last 10 minutes)\n` +
            `Use these as ground truth when the user asks "did that go through?", "did you move it?", or refers to a recent change.\n` +
            `Only claim a write succeeded when its line shows \`verified=true\`. ` +
            `Lines marked \`status=pending\` or \`status=confirmed\` are still AWAITING the user's click in the chat UI — do NOT claim those have executed.\n` +
            lines.join("\n");
        }
      }
    } catch (_workingMemoryErr) {
      // Non-fatal — working memory is best-effort.
    }

    // First call to AI with tools if calendar is connected
    const requestBody: any = {
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemContent },
        ...messages,
      ],
      stream: true,
    };

    // Include tools based on what's connected
    const tools: any[] = [...GOOGLE_FORMS_TOOLS, ...NDA_TOOLS]; // Always available
    if (calendarAccessToken) {
      tools.push(...CALENDAR_TOOLS);
    }
    // reschedule_event is always available — handles local Planner rows even without a personal Google Calendar token.
    tools.push(...RESCHEDULE_TOOLS);
    // Knowledge Base RAG is ALWAYS available (Postgres+pgvector, no Azure dependency)
    tools.push(...KB_TOOLS);
    if (azureStorageAvailable) {
      tools.push(...AZURE_DOC_TOOLS);
    }
    // Meeting tools always available (Gmail connection checked at execution time)
    tools.push(...MEETING_TOOLS);
    // Azure DevOps tools always available (connection checked at execution time)
    tools.push(...AZURE_DEVOPS_TOOLS);
    // Azure Repos tools always available (connection checked at execution time)
    tools.push(...AZURE_REPOS_TOOLS);
    // Xero tools always available (data is synced locally)
    tools.push(...XERO_TOOLS);
    // HubSpot tools always available (connection checked at execution time)
    tools.push(...HUBSPOT_TOOLS);
    // Gmail tools always available (connection checked at execution time)
    tools.push(...GMAIL_TOOLS);
    // Google Drive tools always available (connection checked at execution time)
    tools.push(...GOOGLE_DRIVE_TOOLS);
    if (slackConnection) {
      tools.push(...SLACK_TOOLS);
    }
    // Analytics tools always available
    tools.push(...ANALYTICS_TOOLS);
    // Workstream management tools always available
    tools.push(...WORKSTREAM_TOOLS);
    tools.push(...PLANNER_TOOLS);
    // Executive summary document generation
    tools.push(...EXEC_SUMMARY_TOOLS);
    // Release logging tool (admin-only enforced inside executor)
    tools.push(...RELEASE_TOOLS);
    // Lovable contributors snapshot (admin-only, requires attached screenshot)
    tools.push(...LOVABLE_CONTRIBUTORS_TOOLS);
    // Briefing mode must always return text, never invoke tools.
    // Do NOT set tool_choice without tools — OpenAI rejects that combination.

    // ============================================================
    // Phase 1.5: Intent-based tool filtering.
    // Classify the latest user message and only expose relevant tool
    // groups to the LLM. Falls back to the full toolset when uncertain.
    // Always-on groups (Forms, NDA, Exec Summary, Release, Lovable Contributors)
    // remain available because they're either tiny or admin-gated.
    // ============================================================
    const INTENT_RULES: Array<{ groups: any[][]; re: RegExp }> = [
      { groups: [GMAIL_TOOLS], re: /\b(gmail|email|emails|inbox|draft|drafts|reply|forward|unread|sender|recipient|cc'?d|bcc'?d)\b/i },
      { groups: [CALENDAR_TOOLS], re: /\b(calendar|diary|schedule|availability|free\/busy|free busy|book\b|meeting room|reschedule|invite|invites|event|events|appointment)\b/i },
      { groups: [MEETING_TOOLS], re: /\b(meeting notes?|meetings?\b|recap|action items?|transcript|plaud|gemini|google\s*meet|recording|summary of (the|my|our)\b|minutes\b)\b/i },
      { groups: [WORKSTREAM_TOOLS], re: /\b(workstream|workstreams|kanban|card|cards|ryg|amber|red\/yellow|status update|owner of|pending action|pending actions|action items?|open tasks?|my tasks?|to[- ]?dos?|on my plate|overdue|csv|download|spreadsheet|excel|google sheet|export)\b/i },
      { groups: [PLANNER_TOOLS, CALENDAR_TOOLS], re: /\b(planner|plan\b|roadmap|milestone|sprint plan|backlog|to-do list|reschedule|postpone|move (it|this|the meeting|to tomorrow)|push (back|forward) (the|my)|change (the )?(date|time))\b/i },
      { groups: [ANALYTICS_TOOLS], re: /\b(analytic|analytics|metric|metrics|kpi|dashboard|trend|report|reporting|chart|graph)\b/i },
      { groups: [GOOGLE_DRIVE_TOOLS], re: /\b(drive|google drive|gdrive|folder|shared drive|doc\b|docs\b|sheet\b|sheets\b|slide|slides|file in)\b/i },
      { groups: [DOCUMENT_TOOLS], re: /\b(document|documents|file|files|attachment|policy|policies|contract|nda|sop|playbook|handbook|wiki|knowledge base)\b/i },
      { groups: [SLACK_TOOLS], re: /\b(slack|channel|channels|dm\b|huddle|thread|reaction|posted in)\b/i },
      
      
      { groups: [AZURE_DEVOPS_TOOLS], re: /\b(devops|ado\b|work item|workitem|backlog item|pull request|pr\b|sprint|iteration|user story|epic\b|feature\b|bug\b)\b/i },
      { groups: [AZURE_REPOS_TOOLS], re: /\b(repo|repos|repository|commit|commits|branch|branches|merge|main branch|push|pushed|shipped)\b/i },
      { groups: [XERO_TOOLS], re: /\b(xero|invoice|invoices|revenue|expense|expenses|p&l|profit and loss|balance sheet|finance|financial|cashflow|cash flow|accounts? receivable|accounts? payable)\b/i },
      { groups: [EXEC_SUMMARY_TOOLS], re: /\b(exec(utive)? summary|board pack|investor update|weekly report|monthly report)\b/i },
    ];

    const ALWAYS_ON_TOOLS = [
      ...KB_TOOLS, // Knowledge Base RAG is always available — first port of call for any informational query.
      ...GOOGLE_FORMS_TOOLS,
      ...NDA_TOOLS,
      ...EXEC_SUMMARY_TOOLS,
      ...RELEASE_TOOLS,
      ...LOVABLE_CONTRIBUTORS_TOOLS,
      ...RESCHEDULE_TOOLS,
    ];

    // Build the filtered toolset. If no intent matches, fall back to the full tools array.
    let filteredTools: any[] = tools;
    let intentMatched = false;
    if (!isVoiceMode && latestUserText.length > 0) {
      const matched: any[] = [];
      for (const rule of INTENT_RULES) {
        if (rule.re.test(latestUserText)) {
          intentMatched = true;
          for (const grp of rule.groups) matched.push(...grp);
        }
      }
      if (intentMatched) {
        const seen = new Set<string>();
        filteredTools = [...ALWAYS_ON_TOOLS, ...matched].filter((t: any) => {
          const name = t?.function?.name;
          if (!name || seen.has(name)) return false;
          // Respect connection gates: drop tools whose backing integration isn't available.
          // reschedule_event must remain available even without a personal Google Calendar token
          // (it covers local Planner rows and uses the Duncan calendar identity for Google events).
          if (CALENDAR_TOOLS.includes(t) && !calendarAccessToken && name !== "reschedule_event") return false;
          if (AZURE_DOC_TOOLS.includes(t) && !azureStorageAvailable) return false;
          
          
          if (SLACK_TOOLS.includes(t) && !slackConnection) return false;
          seen.add(name);
          return true;
        });
        console.log(`[intent-filter] matched=${intentMatched} tools=${filteredTools.length}/${tools.length}`);
      }
    }

    // Tool-first guardrail signal: data-bound intents must ground their answer in tools.
    const DATA_INTENT_RE = /\b(meeting|email|inbox|calendar|event|workstream|task|planner|kpi|metric|invoice|xero|devops|work item|drive|document|slack|candidate|recruit|brief|status|summary|report)\b/i;
    const isDataIntent = intentMatched || DATA_INTENT_RE.test(latestUserText);

    // Phase 4: backfill the unified `turn` readout now that all signals are computed.
    turn.intentMatched = intentMatched;
    turn.isDataIntent = isDataIntent;
    turn.bypassTools = shouldBypassTools;
    // Surface the resolver hit (re-derive from the lightweight matcher above so
    // we never silently drift between resolver text and turn.* readout).
    try {
      const _lower = latestUserText.toLowerCase();
      const _aliases: Record<string, string[]> = {
        "Lightning Strike Event": ["lightning strike", "lightning-strike", "lightningstrike", "lightning strike event", "lightning"],
        "Website": ["website", "site", "web site"],
        "K10 App": ["k10", "k10 app", "k-10", "k 10 app"],
        "School Integrations": ["school integrations", "school integration", "schools integration"],
      };
      for (const [tag, aliases] of Object.entries(_aliases)) {
        if (aliases.some((a) => _lower.includes(a))) { turn.resolvedProjectTag = tag; break; }
      }
    } catch { /* ignore */ }
    console.log("[classifyTurn]", {
      intentMatched: turn.intentMatched,
      isDataIntent: turn.isDataIntent,
      bypassTools: turn.bypassTools,
      needsMeetingSourceClarification: turn.needsMeetingSourceClarification,
      explicitSourceMeetingRequest: turn.explicitSourceMeetingRequest,
      resolvedProjectTag: turn.resolvedProjectTag,
      toolCount: filteredTools.length,
    });

    if (isDataIntent && !isVoiceMode && !mustAskMeetingSource && mode !== "briefing" && filteredTools.length > 0) {
      // Phase 1.5 tool-first guardrail: forbid speculation, require tool grounding.
      systemContent += `\n\n## TOOL-FIRST GUARDRAIL\nThe user is asking about real-time or factual data (meetings, emails, calendar, workstreams, planner, analytics, documents, Slack, Xero, DevOps, recruitment, etc.). You MUST call an appropriate tool to ground your answer. If the relevant integration isn't connected OR a tool returns no matching data, say so plainly in one or two sentences and suggest a concrete next step — NEVER invent meetings, emails, events, candidates, invoices, tasks, or any other records. NEVER summarise hypothetical content.`;
      // Rebuild the first request's messages with the updated system prompt.
      requestBody.messages = [
        { role: "system", content: systemContent },
        ...messages,
      ];
    }

    if (mode !== "briefing" && !shouldBypassTools && filteredTools.length > 0) {
      requestBody.tools = filteredTools;
      if (isNdaConfirmationReply && pendingNdaArgsFromHistory) {
        requestBody.tool_choice = { type: "function", function: { name: "generate_nda" } };
      } else if (isDataIntent && !isVoiceMode && !mustAskMeetingSource) {
        requestBody.tool_choice = "auto";
      }
    }

    if (mustAskMeetingSource) {
      requestBody.tools = undefined;
      requestBody.tool_choice = undefined;
      systemContent += `\n\n## CURRENT REQUEST OVERRIDE\nThe latest user request is a source-ambiguous meeting notes request. Reply exactly: "Which source should I use — **Google Meet** or **Plaud**?" Do not call tools.`;
      requestBody.messages = [
        { role: "system", content: systemContent },
        ...messages,
      ];
    }

    // Helper to call LLM via the shared router (Claude primary, OpenAI fallback).
    // Returns a synthetic Response whose .body is OpenAI-shaped SSE so downstream parser
    // (parseSSEStream) keeps working unchanged.
    async function fetchAIWithRetry(body: any): Promise<Response> {
      try {
        const stream = await streamLLM({
          workflow: "norman-chat",
          messages: body.messages,
          tools: body.tools,
          tool_choice: body.tool_choice,
          temperature: body.temperature,
          max_tokens: body.max_tokens,
          force_provider: body.force_provider,
          model_override: body.model_override,
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      } catch (err: any) {
        const status = err?.status || 500;
        const text = err?.message || "LLM router error";
        console.error("[norman-chat] streamLLM failed:", status, text);
        return new Response(text, { status });
      }
    }

    function getToolSchema(toolName: string): any | undefined {
      return tools.find((tool) => tool?.function?.name === toolName)?.function?.parameters;
    }

    function extractJsonCandidate(raw: string): string {
      const withoutFences = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");

      const objectStart = withoutFences.indexOf("{");
      const arrayStart = withoutFences.indexOf("[");
      const starts = [objectStart, arrayStart].filter((index) => index >= 0);

      if (starts.length === 0) return withoutFences;
      return withoutFences.slice(Math.min(...starts));
    }

    function repairJsonCandidate(raw: string): string {
      const input = extractJsonCandidate(raw)
        .replace(/[“”]/g, '"')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

      let output = "";
      const closers: string[] = [];
      let inString = false;
      let escaped = false;

      for (const ch of input) {
        if (inString) {
          output += ch;
          if (escaped) {
            escaped = false;
            continue;
          }
          if (ch === "\\") {
            escaped = true;
            continue;
          }
          if (ch === '"') {
            inString = false;
          }
          continue;
        }

        if (ch === '"') {
          inString = true;
          output += ch;
          continue;
        }

        if (ch === "{") closers.push("}");
        if (ch === "[") closers.push("]");

        if (ch === "}" || ch === "]") {
          const expected = closers[closers.length - 1];
          if (!expected) continue;
          while (closers.length > 0 && closers[closers.length - 1] !== ch) {
            output += closers.pop();
          }
          if (closers[closers.length - 1] === ch) {
            closers.pop();
          }
        }

        output += ch;
      }

      if (inString) output += '"';
      output = output.replace(/,\s*([}\]])/g, "$1");
      while (closers.length > 0) output += closers.pop();
      return output.trim();
    }

    function parseToolArguments(toolCall: any): {
      args: Record<string, any>;
      valid: boolean;
      normalizedArguments: string;
      rawArguments: string;
      missingRequired: string[];
      likelyIncomplete: boolean;
      parseError?: string;
      repaired: boolean;
    } {
      const toolName = typeof toolCall?.function?.name === "string" ? toolCall.function.name : "unknown_tool";
      const schema = getToolSchema(toolName);
      const required = Array.isArray(schema?.required) ? schema.required : [];
      const rawValue = toolCall?.function?.arguments;
      const rawArguments = typeof rawValue === "string"
        ? rawValue
        : rawValue == null
          ? ""
          : JSON.stringify(rawValue);
      const trimmedArguments = rawArguments.trim();

      let parsed: any = {};
      let parseError: string | undefined;
      let repaired = false;

      if (typeof rawValue === "object" && rawValue !== null) {
        parsed = rawValue;
      } else if (rawArguments.trim().length > 0) {
        try {
          parsed = JSON.parse(rawArguments);
        } catch {
          try {
            parsed = JSON.parse(repairJsonCandidate(rawArguments));
            repaired = true;
          } catch (repairError) {
            parseError = repairError instanceof Error ? repairError.message : String(repairError);
          }
        }
      }

      const objectArgs = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};

      const missingRequired = (required as string[]).filter((key: string) => {
        const value = objectArgs[key];
        return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
      });

      const openCurly = (trimmedArguments.match(/\{/g) ?? []).length;
      const closeCurly = (trimmedArguments.match(/\}/g) ?? []).length;
      const openSquare = (trimmedArguments.match(/\[/g) ?? []).length;
      const closeSquare = (trimmedArguments.match(/\]/g) ?? []).length;
      const endsMidStructure = /[\[{:,]\s*$/.test(trimmedArguments);
      const hasUnbalancedDelimiters = openCurly !== closeCurly || openSquare !== closeSquare;
      const likelyIncomplete = trimmedArguments.length > 0 && (
        !!parseError
        || endsMidStructure
        || hasUnbalancedDelimiters
        || (repaired && missingRequired.length > 0)
      );

      return {
        args: objectArgs,
        valid: !parseError && missingRequired.length === 0,
        normalizedArguments: JSON.stringify(objectArgs),
        rawArguments,
        missingRequired,
        likelyIncomplete,
        parseError,
        repaired,
      };
    }

    // Phase 2b: skip the initial LLM round when this request is just executing
    // a previously-confirmed write action — the executeWriteId branch below
    // handles it without any model tokens.
    const response = executeWriteId ? null as any : await fetchAIWithRetry(requestBody);

    if (!executeWriteId) {
      console.log("LLM RESPONSE OBJECT", {
        round: 0,
        responseType: typeof response,
        hasBody: response.body !== null,
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.error("AI rate limit exceeded after retries");
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (response.status === 402) {
          return new Response(
            JSON.stringify({ error: "AI credits exhausted. Please add funds in workspace settings." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const text = await response.text();
        console.error("AI gateway error:", response.status, text);
        return new Response(
          JSON.stringify({ error: "AI gateway error" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }


    // Consume an OpenAI-shaped SSE stream while optionally forwarding each chunk to the client
    // immediately. We suppress upstream [DONE] so norman-chat emits it only once after the final round.
    async function consumeSSEStream(
      streamResponse: Response,
      onChunk?: (chunk: string) => void,
    ): Promise<{ fullContent: string; toolCalls: any[]; finishReason: string | null; sawAnyDelta: boolean; sawContentDelta: boolean; sawToolDelta: boolean; hadIncompleteToolCall: boolean }> {
      const reader = streamResponse.body!.getReader();
      const decoder = new TextDecoder();
      const TEXT_INACTIVITY_TIMEOUT_MS = Number.POSITIVE_INFINITY;
      const TEXT_MAX_STREAM_DURATION_MS = Number.POSITIVE_INFINITY;
      const TOOL_INACTIVITY_TIMEOUT_MS = Number.POSITIVE_INFINITY;
      const TOOL_MAX_STREAM_DURATION_MS = Number.POSITIVE_INFINITY;
      const READ_POLL_MS = 500;
      let fullContent = "";
      const toolCalls: any[] = [];
      let buffer = "";
      const startTime = Date.now();
      let lastChunkTime = startTime;
      let hasToolCallStarted = false;
      let finishReason: string | null = null;
      let sawAnyDelta = false;
      let sawContentDelta = false;
      let sawToolDelta = false;

       const hasToolName = (toolCall: any) => {
        const name = toolCall?.function?.name;
        return typeof name === "string" && name.trim().length > 0;
      };

       const hasIncompleteToolCall = () => hasToolCallStarted && toolCalls.some((toolCall) => {
         if (!toolCall) return false;
         if (!hasToolName(toolCall)) {
           const hasId = typeof toolCall?.id === "string" && toolCall.id.trim().length > 0;
           const argText = typeof toolCall?.function?.arguments === "string" ? toolCall.function.arguments.trim() : "";
           return hasId || argText.length > 0;
         }
         const parsed = parseToolArguments(toolCall);
         return parsed.likelyIncomplete;
       });

      try {
        while (true) {
          const totalMs = Date.now() - startTime;
          const inactivityMs = Date.now() - lastChunkTime;
          const inactivityTimeoutMs = hasToolCallStarted ? TOOL_INACTIVITY_TIMEOUT_MS : TEXT_INACTIVITY_TIMEOUT_MS;
          const maxDurationMs = hasToolCallStarted ? TOOL_MAX_STREAM_DURATION_MS : TEXT_MAX_STREAM_DURATION_MS;

          const readResult = await Promise.race<
            ReadableStreamReadResult<Uint8Array> | { timeout: true }
          >([
            reader.read(),
            new Promise((resolve) => setTimeout(() => resolve({ timeout: true as const }), READ_POLL_MS)),
          ]);

          if ("timeout" in readResult) {
            continue;
          }

          const { done, value } = readResult;
          if (done) break;

          lastChunkTime = Date.now();
          buffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);

            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") continue;
            if (!line.startsWith("data: ")) continue;

            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") continue;

            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed?.error) {
                console.error("LLM stream payload error:", parsed.error);
              }
              const delta = parsed.choices?.[0]?.delta;
              const chunkFinishReason = parsed.choices?.[0]?.finish_reason;

              if (chunkFinishReason) {
                finishReason = chunkFinishReason;
              }

              if (delta?.content) {
                fullContent += delta.content;
                sawAnyDelta = true;
                sawContentDelta = true;
              }

              if (delta?.tool_calls) {
                hasToolCallStarted = true;
                sawAnyDelta = true;
                sawToolDelta = true;
                for (const tc of delta.tool_calls) {
                  const index = tc.index;
                  if (!toolCalls[index]) {
                    const hasIdentity = !!tc.id || !!tc.function?.name;
                    if (!hasIdentity) {
                      continue;
                    }
                    toolCalls[index] = { id: tc.id, type: "function", function: { name: "", arguments: "" } };
                  }
                  if (tc.id) {
                    toolCalls[index].id = tc.id;
                  }
                  if (tc.function?.name) {
                    toolCalls[index].function.name = tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    toolCalls[index].function.arguments += tc.function.arguments;
                  }
                }
              }

              if (onChunk) {
                onChunk(`data: ${JSON.stringify(parsed)}\n\n`);
              }
            } catch {
              buffer = line + "\n" + buffer;
              break;
            }
          }
        }
      } finally {
        try {
          await reader.cancel();
        } catch {
          // best-effort cleanup only
        }
      }

       const capturedToolCalls = hasToolCallStarted
         ? toolCalls
             .filter(hasToolName)
             .map((toolCall) => {
                const parsedArguments = parseToolArguments(toolCall);

                return {
                 id: typeof toolCall?.id === "string" && toolCall.id.trim().length > 0
                   ? toolCall.id
                   : `streamed_tool_${Math.random().toString(36).slice(2, 10)}`,
                 type: "function",
                 function: {
                   name: toolCall.function.name,
                    arguments: parsedArguments.valid ? parsedArguments.normalizedArguments : parsedArguments.rawArguments,
                 },
                 _debug: {
                    rawArgumentsLength: parsedArguments.rawArguments.length,
                    argumentsParseable: parsedArguments.valid,
                    repaired: parsedArguments.repaired,
                     likelyIncomplete: parsedArguments.likelyIncomplete,
                    missingRequired: parsedArguments.missingRequired,
                    parseError: parsedArguments.parseError,
                 },
               };
             })
         : toolCalls;

       const hadIncompleteToolCall = hasIncompleteToolCall()
         || (finishReason === "tool_calls" && capturedToolCalls.length === 0);

       console.log("STREAM RESULT:");
       console.log({
         fullContentLength: fullContent?.length || 0,
         preview: fullContent?.slice(0, 200),
         toolCallsLength: capturedToolCalls?.length || 0,
          finishReason,
          sawAnyDelta,
          sawContentDelta,
          sawToolDelta,
       });

       return {
         fullContent,
         toolCalls: capturedToolCalls.map(({ _debug, ...toolCall }: any) => toolCall),
          finishReason,
          sawAnyDelta,
          sawContentDelta,
          sawToolDelta,
           hadIncompleteToolCall,
       };
    }

    const TOOL_EXECUTION_TIMEOUT_MS = 10_000;
    const PLAUD_SYNC_INTENT_RE = /\b(sync|refresh|import|pull\s+(new|latest)|update)\b[\s\S]{0,40}\bplaud\b/i;

    // Phase 1 + Phase 8 — canonical tool-result envelope helpers live in
    // `../_shared/tool-envelope.ts`. ToolResultStatus / createStructuredToolResult /
    // classifyToolOutcome are imported at the top of this file so future
    // executors (confirm-chat-write, project chat) can share the same shape
    // and the Mutation Truth Rule remains structurally enforceable.

    async function withToolTimeout<T>(toolName: string, work: Promise<T>): Promise<T> {
      return await Promise.race([
        work,
        new Promise<T>((_, reject) => {
          setTimeout(() => reject(new Error(`${toolName} timed out after ${TOOL_EXECUTION_TIMEOUT_MS}ms`)), TOOL_EXECUTION_TIMEOUT_MS);
        }),
      ]);
    }

    // Helper to execute tool calls and return results
    function detectToolResultProvider(toolCalls: any[]): "anthropic" | "openai" {
      const firstTool = toolCalls.find((tc) => tc && typeof tc === "object");
      const toolId = typeof firstTool?.id === "string" ? firstTool.id : "";

      if (!toolId) {
        console.warn("Tool call ID missing, using fallback provider", toolCalls);
      }

      if (toolId.startsWith("toolu_")) return "anthropic";
      if (toolId.startsWith("call_")) return "openai";

      if (firstTool?.type === "function") {
        return "openai";
      }

      return "openai";
    }

    async function executeToolCalls(
      toolCalls: any[],
      provider: "anthropic" | "openai",
      opts: { emit?: (event: any) => void; bypassWriteConfirm?: boolean } = {}
    ): Promise<any[]> {
      const emit = opts.emit ?? (() => {});
      const bypassWriteConfirm = !!opts.bypassWriteConfirm;

      const calendarToolNames = ["list_calendar_events", "create_calendar_event", "update_calendar_event", "delete_calendar_event"];
      const documentToolNames = ["search_knowledge_base", "search_documents", "read_document", "list_documents"];
      
      const googleFormsToolNames = ["list_google_forms", "submit_google_form", "parse_google_form", "save_parsed_google_form"];
      const ndaToolNames = ["generate_nda", "list_nda_submissions", "send_nda_for_signature", "send_pdf_for_signature"];
      
      const meetingToolNames = ["fetch_plaud_meetings", "list_meetings", "list_meetings_by_source", "get_meeting", "get_meeting_action_items_with_context", "get_action_items_for_range", "analyze_meetings", "search_meeting_transcripts"];
      const azureDevOpsToolNames = ["list_azure_devops_projects", "query_azure_work_items", "get_azure_work_item", "search_synced_work_items"];
      const azureReposToolNames = ["list_azure_repos", "get_recent_commits", "list_pull_requests", "get_pr_reviews", "get_repos_team_summary"];
      const xeroToolNames = ["list_xero_invoices", "get_xero_invoice", "approve_xero_invoice_payment", "search_xero_contacts", "create_xero_invoice", "list_xero_bank_accounts", "create_xero_expense"];
      const hubspotToolNames = ["get_hubspot_pipeline_summary", "search_hubspot"];
      const gmailToolNames = ["list_gmail_emails", "search_gmail", "read_gmail_email", "send_gmail_email", "read_gmail_thread", "draft_gmail_reply", "draft_gmail_email"];
      const driveToolNames = ["drive_list_files", "drive_search", "drive_get_content"];
      const slackToolNames = ["list_slack_channels", "read_slack_channel_messages", "send_slack_message"];
      const analyticsToolNames = ["get_workstream_analytics", "get_recruitment_analytics", "get_team_activity_analytics", "get_operational_summary", "get_google_analytics_dashboard"];
      const workstreamMgmtToolNames = ["list_team_members", "list_workstream_cards", "create_workstream_card", "add_tasks_to_card", "update_workstream_card", "check_team_availability"];
      const plannerToolNames = ["list_planner_events", "update_planner_event_meta"];
      const execSummaryToolNames = ["generate_exec_summary_document"];
      const releaseToolNames = ["log_release_change"];
      const lovableContribToolNames = ["update_lovable_contributors"];
      const toolResults: any[] = [];

      // Phase 1: run all tools in this round in parallel (Promise.allSettled preserves order).
      // Each tool has its own 10s timeout via withToolTimeout. A small semaphore caps concurrency at 5.
      const CONCURRENCY = 5;
      let activeCount = 0;
      const pending: Array<() => void> = [];
      const acquire = () =>
        new Promise<void>((resolve) => {
          if (activeCount < CONCURRENCY) {
            activeCount++;
            resolve();
          } else {
            pending.push(() => {
              activeCount++;
              resolve();
            });
          }
        });
      const release = () => {
        activeCount--;
        const next = pending.shift();
        if (next) next();
      };

      const runOne = async (tc: any): Promise<any> => {
        await acquire();
        try {
          const parsedArguments = parseToolArguments(tc);
          const rawArguments = parsedArguments.rawArguments;
          const args = parsedArguments.args;

          console.log("Executing tool call", {
            toolName: tc?.function?.name,
            rawArguments,
            parsedArgs: args,
            repairedArguments: parsedArguments.repaired,
            likelyIncomplete: parsedArguments.likelyIncomplete,
            missingRequired: parsedArguments.missingRequired,
            parseError: parsedArguments.parseError,
          });

          if (!parsedArguments.valid) {
            const invalidReason = parsedArguments.parseError
              ? `Malformed tool arguments: ${parsedArguments.parseError}`
              : `Missing required arguments: ${parsedArguments.missingRequired.join(", ")}`;
            throw new Error(invalidReason);
          }

          const toolNameForEvent = tc?.function?.name ?? "unknown_tool";

          // Phase 2b: circuit breaker — short-circuit known-broken tools
          if (circuitIsOpen(toolNameForEvent)) {
            emit({ duncan_event: "tool_end", id: tc?.id, name: toolNameForEvent, status: "circuit_open" });
            const cbResult = createStructuredToolResult(toolNameForEvent, {
              error: `Tool '${toolNameForEvent}' is temporarily disabled after repeated failures. Try again in a minute or use an alternative source.`,
            }, "hard_error");
            const finalContent = JSON.stringify(cbResult);
            if (provider === "anthropic") {
              return { role: "user", content: [{ type: "tool_result", tool_use_id: tc?.id, content: finalContent }] };
            }
            return { role: "tool", tool_call_id: tc?.id, content: finalContent };
          }

          emit({ duncan_event: "tool_start", id: tc?.id, name: toolNameForEvent });

          // Phase 2b: write-tool interception. Queue a pending row, emit a
          // tool_pending event so the UI can render a Confirm/Cancel card, and
          // return a synthetic "awaiting confirmation" tool result to the model
          // so it stops further tool calls and produces a user-facing summary.
          if (WRITE_TOOLS.has(toolNameForEvent) && !bypassWriteConfirm) {
            try {
              const summary = summarizeWriteAction(toolNameForEvent, args);
              const idemSource = `${userId}:${toolNameForEvent}:${JSON.stringify(args ?? {})}`;
              const idempotency_key = await sha256Hex(idemSource);

              // Reuse existing pending row if same logical action is already queued.
              const { data: existing } = await supabaseAdmin
                .from("chat_write_pending")
                .select("id, status, expires_at")
                .eq("user_id", userId)
                .eq("idempotency_key", idempotency_key)
                .in("status", ["pending", "confirmed", "executed"])
                .maybeSingle();

              let pendingId: string | null = existing?.id ?? null;

              if (!pendingId) {
                const { data: inserted, error: insErr } = await supabaseAdmin
                  .from("chat_write_pending")
                  .insert({
                    user_id: userId,
                    tool_name: toolNameForEvent,
                    tool_args: args ?? {},
                    summary,
                    idempotency_key,
                  })
                  .select("id")
                  .single();
                if (insErr) throw insErr;
                pendingId = inserted.id;
              }

              emit({
                duncan_event: "tool_pending",
                id: tc?.id,
                name: toolNameForEvent,
                pendingId,
                summary,
                args,
              });
              emit({ duncan_event: "tool_end", id: tc?.id, name: toolNameForEvent, status: "pending_confirmation" });

              const stub = createStructuredToolResult(toolNameForEvent, {
                status: "pending_confirmation",
                ok: false,
                verified: false,
                pending_id: pendingId,
                summary,
                message: "AWAITING_USER_CONFIRMATION — this write has NOT executed. Per the Mutation Truth Rule (ok=false, verified=false, status=pending_confirmation), you MUST tell the user the action is queued and awaiting their click in the chat UI. Do NOT claim it is done. Do NOT retry this tool. Do NOT call any further write tools for this entity in this turn.",
              }, "pending_confirmation");
              const finalContent = JSON.stringify(stub);
              if (provider === "anthropic") {
                return { role: "user", content: [{ type: "tool_result", tool_use_id: tc?.id, content: finalContent }] };
              }
              return { role: "tool", tool_call_id: tc?.id, content: finalContent };
            } catch (queueErr: any) {
              console.error("[write-confirm] failed to queue pending write:", queueErr);
              // Fall through to normal execution as last-resort safety net only if
              // confirmation infra is broken — but emit the failure for the UI.
              emit({ duncan_event: "tool_end", id: tc?.id, name: toolNameForEvent, status: "queue_failed", error: String(queueErr?.message ?? queueErr) });
              const errResult = createStructuredToolResult(toolNameForEvent, {
                error: "Could not queue this action for confirmation. Aborting for safety.",
              }, "hard_error");
              const finalContent = JSON.stringify(errResult);
              if (provider === "anthropic") {
                return { role: "user", content: [{ type: "tool_result", tool_use_id: tc?.id, content: finalContent }] };
              }
              return { role: "tool", tool_call_id: tc?.id, content: finalContent };
            }
          }

          let result: any;
          

          
          if (tc.function.name === "reschedule_event") {
            result = await withToolTimeout(tc.function.name, executeRescheduleTool(args, supabaseAdmin, userId || null));
          } else if (calendarToolNames.includes(tc.function.name)) {
            const writeTools = new Set(["create_calendar_event", "update_calendar_event", "delete_calendar_event"]);
            const isWrite = writeTools.has(tc.function.name);
            // Admins can write via Duncan even without a personal calendar connection.
            // Reads still require the user's personal token.
            if (!calendarAccessToken && !(isWrite && duncanCalendar)) {
              result = { error: "Google Calendar is not connected. Please connect it via the Integrations page." };
            } else {
              result = await withToolTimeout(tc.function.name, executeCalendarTool(tc.function.name, args, calendarAccessToken || "", resolvedIdentity, duncanCalendar));
            }

          } else if (documentToolNames.includes(tc.function.name)) {
            if (!azureStorageAvailable) {
              result = { error: "Document storage is not configured. Please contact an admin." };
            } else {
              result = await withToolTimeout(tc.function.name, executeDocumentTool(tc.function.name, args, supabaseUrl, authHeader || ""));
            }
          } else if (googleFormsToolNames.includes(tc.function.name)) {
            result = await withToolTimeout(tc.function.name, executeGoogleFormsTool(tc.function.name, args, supabaseAdmin));
          } else if (ndaToolNames.includes(tc.function.name)) {
            result = await withToolTimeout(tc.function.name, executeNdaTool(tc.function.name, args, supabaseAdmin, userId || "", userEmail, authHeader || ""));
          } else if (meetingToolNames.includes(tc.function.name)) {
              // Phase 1: hard server-side guard on the slow Plaud sync. Only run when the user
              // explicitly asked for a sync/refresh/import/update of Plaud data.
              if (tc.function.name === "fetch_plaud_meetings" && !PLAUD_SYNC_INTENT_RE.test(latestUserText)) {
                console.log("BLOCKED fetch_plaud_meetings — no explicit sync intent in user message");
                result = createStructuredToolResult(tc.function.name, {
                  message: "Skipped Plaud sync. This is a slow operation and only runs when the user explicitly asks to sync, refresh, import, or update Plaud meeting data. Use list_meetings / search_meeting_transcripts / get_meeting instead for existing data.",
                }, "no_data");
              } else {
                result = await withToolTimeout(tc.function.name, executeMeetingTool(tc.function.name, args, supabaseAdmin, supabaseUser, supabaseUrl, authHeader || "", userId || "", meetingFlowState, resolvedIdentity));
              }
          } else if (azureDevOpsToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeAzureDevOpsTool(tc.function.name, args, supabaseAdmin, supabaseUrl, authHeader || ""));
          } else if (azureReposToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeAzureReposTool(tc.function.name, args, supabaseUrl, authHeader || ""));
          } else if (xeroToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeXeroTool(tc.function.name, args, supabaseAdmin, supabaseUrl, authHeader || "", userId || ""));
          } else if (hubspotToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeHubspotTool(tc.function.name, args, supabaseUrl, authHeader || ""));
           } else if (gmailToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeGmailTool(tc.function.name, args, supabaseUrl, authHeader || "", resolvedIdentity));
          } else if (driveToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeDriveTool(tc.function.name, args, supabaseUrl, authHeader || "", resolvedIdentity));
            } else if (slackToolNames.includes(tc.function.name)) {
              if (!slackConnection) {
                result = { error: "Slack is not connected. Please connect it via the Integrations page." };
              } else {
                result = await withToolTimeout(tc.function.name, executeSlackTool(tc.function.name, args, slackConnection.accessToken));
              }
           } else if (analyticsToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeAnalyticsTool(tc.function.name, args, supabaseAdmin, supabaseUrl, authHeader || ""));
          } else if (workstreamMgmtToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeWorkstreamTool(tc.function.name, args, supabaseAdmin, userId || "", resolvedIdentity, identityCache));
          } else if (plannerToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executePlannerTool(tc.function.name, args, supabaseAdmin));
          } else if (execSummaryToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeExecSummaryTool(tc.function.name, args, supabaseUrl, authHeader || ""));
          } else if (releaseToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeReleaseTool(tc.function.name, args, supabaseAdmin, userId || ""));
          } else if (lovableContribToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeLovableContributorsTool(tc.function.name, args, supabaseAdmin, userId || ""));
          } else {
              result = { error: `Unknown tool: ${tc.function.name}` };
          }
          
          const toolName = tc?.function?.name ?? "unknown_tool";
          const toolOutcome = classifyToolOutcome(toolName, result);

          // Phase 9: capture the envelope for the post-LLM correctness linter.
          try {
            executedToolEnvelopes.push({ tool: toolName, envelope: toolOutcome.payload as any });
          } catch { /* non-fatal */ }

          // Phase 2b: feed circuit breaker + emit tool_end
          if (toolOutcome.status === "hard_error") {
            recordToolFailure(toolName);
          } else {
            recordToolSuccess(toolName);
          }
          emit({ duncan_event: "tool_end", id: tc?.id, name: toolName, status: toolOutcome.status });

          console.log("TOOL RESULT RAW:", result);
          console.log("TOOL RESULT TYPE:", typeof result);
          console.log("TOOL RESULT STATUS:", toolOutcome.status);


          const finalContent = (() => {
            const normalizedResult = toolOutcome.payload;
            if (normalizedResult == null) return "{}";
            if (typeof normalizedResult === "string") return normalizedResult.length > 0 ? normalizedResult : "{}";
            const stringified = JSON.stringify(normalizedResult);
            return stringified.length > 0 ? stringified : "{}";
          })();

          console.log("ADDING TOOL MESSAGE:");
          console.log("tool_call_id:", tc?.id);
          console.log("tool_name:", tc?.function?.name);
          console.log("content:", finalContent);
          console.log("content_length:", finalContent?.length);

          console.log("TOOL RESULT SENT:", {
            provider,
            tool_id: tc?.id,
            content_length: finalContent.length,
          });

          if (provider === "anthropic") {
            return {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: tc?.id,
                  content: finalContent,
                },
              ],
            };
          }
          return {
            role: "tool",
            tool_call_id: tc?.id,
            content: finalContent,
          };
        } catch (error: any) {
          const toolError = error instanceof Error ? error : new Error(String(error));
          console.error(`Tool ${tc.function.name} threw error:`, toolError.message, toolError.stack);
          const toolName = tc?.function?.name ?? "unknown_tool";
          const isTimeout = toolError.message.toLowerCase().includes("timed out");
          recordToolFailure(toolName);
          emit({ duncan_event: "tool_end", id: tc?.id, name: toolName, status: isTimeout ? "timeout" : "error", error: toolError.message });
          const errorResult = isTimeout
            ? createStructuredToolResult(toolName, {
                error: toolError.message,
                fallback_message: "Continue with the rest of the context and treat this source as temporarily unavailable.",
              }, "partial")
            : createStructuredToolResult(toolName, { error: toolError.message }, "hard_error");
          const finalContent = JSON.stringify(errorResult) || "{}";


          console.log("TOOL ERROR SENT:", {
            provider,
            tool_id: tc?.id,
            content_length: finalContent.length,
          });

          if (provider === "anthropic") {
            return {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: tc?.id,
                  content: finalContent,
                },
              ],
            };
          }
          return {
            role: "tool",
            tool_call_id: tc?.id,
            content: finalContent,
          };
        } finally {
          release();
        }
      };

      // Run all tools concurrently; order matches `toolCalls` (required by OpenAI tool_call_id pairing).
      const settled = await Promise.all(toolCalls.map((tc: any) => runOne(tc)));
      for (const r of settled) toolResults.push(r);



      return toolResults;
    }

    function sanitizeConversationMessages(messagesToSanitize: any[]): any[] {
      const sanitized: any[] = [];

      for (const message of messagesToSanitize) {
        if (!message || typeof message !== "object") continue;

        if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
          const validToolCalls = message.tool_calls.filter((toolCall: any) => {
            const toolName = toolCall?.function?.name;
            return typeof toolName === "string" && toolName.trim().length > 0;
          });

          if (validToolCalls.length === 0 && !message.content) {
            continue;
          }

          sanitized.push({
            ...message,
            ...(validToolCalls.length > 0 ? { tool_calls: validToolCalls } : {}),
            ...(validToolCalls.length === 0 ? { tool_calls: undefined } : {}),
          });
          continue;
        }

        if (message.role === "tool") {
          const toolCallId = typeof message.tool_call_id === "string" ? message.tool_call_id.trim() : "";
          if (!toolCallId) continue;
        }

        sanitized.push(message);
      }

      return sanitized;
    }

    // ====================================================================
    // Phase 6 — Kill silent recovery paths.
    //
    // Invariant: a tool call MUST originate from the streamed model output
    // for the current turn. The recovery path is therefore TEXT-ONLY:
    //   • We never pass `tools` to the recovery request.
    //   • If the model still tries to emit tool calls, we discard them.
    //   • If recovery cannot produce a user-facing answer, we return a
    //     typed error envelope that the caller surfaces as a retry
    //     affordance — we NEVER silently re-invoke write tools.
    // ====================================================================
    async function recoverEmptyCompletion(baseMessages: any[]): Promise<{
      fullContent: string;
      error: { code: string; message: string; retryable: boolean } | null;
    }> {
      const recoveryMessages = [
        ...sanitizeConversationMessages(baseMessages),
        {
          role: "system",
          content:
            "The prior completion returned no visible answer. Respond to the user in plain text only. Do NOT call any tools — tools were intentionally withheld for this recovery turn. If you cannot answer from prior tool results, say so honestly and suggest the user retry.",
        },
      ];

      const providers: Array<"claude" | "openai"> = ["claude", "openai"];

      for (const provider of providers) {
        console.log("EMPTY COMPLETION RECOVERY ATTEMPT (text-only)", {
          provider,
          messageCount: recoveryMessages.length,
        });

        const recoveryResponse = await fetchAIWithRetry({
          messages: recoveryMessages,
          stream: true,
          // Phase 6 invariant: never offer tools during recovery.
          tools: undefined,
          force_provider: provider,
        });

        if (!recoveryResponse.ok) {
          console.error("Empty completion recovery failed before streaming", {
            provider,
            status: recoveryResponse.status,
          });
          continue;
        }

        const recoveryResult = await consumeSSEStream(recoveryResponse);
        console.log("EMPTY COMPLETION RECOVERY RESULT", {
          provider,
          fullContentLength: recoveryResult.fullContent.length,
          toolCallsLength: recoveryResult.toolCalls.length,
          finishReason: recoveryResult.finishReason,
          sawAnyDelta: recoveryResult.sawAnyDelta,
        });

        if (recoveryResult.toolCalls.length > 0) {
          // Hard invariant violation — model tried to fabricate tool calls
          // in a turn where the user-visible stream produced none. Discard.
          console.warn("RECOVERY ATTEMPTED TO FABRICATE TOOL CALLS — discarding", {
            attempted: recoveryResult.toolCalls.map((tc: any) => tc?.function?.name),
          });
        }

        if (recoveryResult.fullContent.trim().length > 0) {
          return {
            fullContent: recoveryResult.fullContent,
            error: null,
          };
        }
      }

      return {
        fullContent: "I couldn't complete that turn cleanly. Nothing was changed. Please retry your request.",
        error: {
          code: "empty_completion",
          message: "Model returned no usable answer and recovery produced no text.",
          retryable: true,
        },
      };
    }

    const encoder = new TextEncoder();
    // Friendly labels for the "Sources used" footer.
    const SOURCE_LABELS: Record<string, string> = {
      search_emails: "Gmail", read_email: "Gmail", send_email: "Gmail", draft_email: "Gmail", reply_email: "Gmail", forward_email: "Gmail",
      list_calendar_events: "Google Calendar", create_calendar_event: "Google Calendar", update_calendar_event: "Google Calendar", delete_calendar_event: "Google Calendar", check_team_availability: "Google Calendar",
      fetch_plaud_meetings: "Plaud Meetings", list_meetings: "Meetings", get_meeting: "Meetings", get_meeting_action_items_with_context: "Meetings",
      list_workstream_cards: "Workstreams", get_workstream_card: "Workstreams", create_workstream_card: "Workstreams", update_workstream_card: "Workstreams",
      list_planner_items: "Planner", create_planner_item: "Planner", update_planner_item: "Planner",
      list_drive_files: "Google Drive", read_drive_file: "Google Drive", search_drive: "Google Drive",
      list_documents: "Documents", read_document: "Documents", search_documents: "Documents",
      list_slack_channels: "Slack", read_slack_messages: "Slack", post_slack_message: "Slack",
      list_devops_work_items: "Azure DevOps", get_devops_work_item: "Azure DevOps", list_devops_commits: "Azure DevOps",
      list_azure_repo_commits: "Azure Repos",
      list_invoices: "Xero", list_contacts: "Xero", get_pnl: "Xero",
      
      
    };
    const sourcesUsed: Record<string, number> = {};
    // Phase 9: collect every executed tool envelope so the post-LLM
    // correctness linter can verify that the model's claims are backed by
    // ReadResult-tagged tool outputs from this turn.
    const executedToolEnvelopes: ToolCallRecord[] = [];
    const recordToolCalls = (toolCalls: any[]) => {
      for (const tc of toolCalls || []) {
        const name = tc?.function?.name;
        if (!name) continue;
        const label = SOURCE_LABELS[name] || name.replace(/_/g, " ");
        sourcesUsed[label] = (sourcesUsed[label] || 0) + 1;
      }
    };

    // ====================================================================
    // Phase 2b: executeWriteId path — invoked by confirm-chat-write after
    // the user has explicitly confirmed a pending write action.
    // ====================================================================
    if (typeof executeWriteId === "string" && executeWriteId.length > 0) {
      const { data: row, error: rowErr } = await supabaseAdmin
        .from("chat_write_pending")
        .select("*")
        .eq("id", executeWriteId)
        .maybeSingle();
      if (rowErr || !row) {
        return new Response(JSON.stringify({ error: "Pending action not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (row.user_id !== userId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (row.status === "executed" && row.result) {
        return new Response(JSON.stringify({ ok: true, result: row.result, alreadyExecuted: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!["pending", "confirmed"].includes(row.status)) {
        return new Response(JSON.stringify({ error: `Cannot execute: status=${row.status}` }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const syntheticToolCall = {
        id: `call_exec_${executeWriteId}`,
        type: "function",
        function: { name: row.tool_name, arguments: JSON.stringify(row.tool_args ?? {}) },
      };

      try {
        const results = await executeToolCalls([syntheticToolCall], "openai", { bypassWriteConfirm: true });
        const content = (results?.[0] as any)?.content;
        let parsed: any = null;
        try { parsed = typeof content === "string" ? JSON.parse(content) : content; } catch { parsed = { raw: content }; }

        // Mutation Truth Rule: the canonical envelope's ok+verified is the source of truth.
        // hard_error / partial / no envelope = not verified.
        const envelopeOk = parsed?.ok === true && parsed?.verified === true;
        const status = parsed?.status ?? (envelopeOk ? "success" : "hard_error");

        return new Response(JSON.stringify({
          ok: envelopeOk,
          verified: parsed?.verified === true,
          status,
          source: parsed?.source ?? null,
          tool: row.tool_name,
          summary: row.summary ?? null,
          before: parsed?.before ?? null,
          after: parsed?.after ?? null,
          error: parsed?.error ?? null,
          result: parsed,
        }), {
          status: envelopeOk ? 200 : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ ok: false, verified: false, status: "hard_error", error: e?.message || "Execution failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const stream = new ReadableStream({

      async start(controller) {
        const enqueue = (chunk: string) => controller.enqueue(encoder.encode(chunk));
        const emitDuncanEvent = (evt: any) => {
          try { enqueue(`data: ${JSON.stringify(evt)}\n\n`); } catch { /* closed */ }
        };
        let aggregatedContent = "";
        let lastFullContent = "";

        // Phase 7 — Structured per-turn observability.
        const turnId = (globalThis.crypto?.randomUUID?.() ?? `turn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
        const turnStartedAt = Date.now();
        const turnLog = {
          turn_id: turnId,
          user_id: userId,
          intent: (typeof turn !== "undefined" ? (turn as any)?.intentMatched ?? null : null) as string | null,
          bypass_tools: (typeof turn !== "undefined" ? (turn as any)?.bypassTools ?? false : false) as boolean,
          tools_called: [] as string[],
          mutation_ok: null as boolean | null,
          mutation_verified: null as boolean | null,
          rounds: 0,
          empty_completion: false,
          fabricated_tool_call: false,
        };
        const recordTurnToolOutcomes = (toolResults: any[]) => {
          for (const msg of toolResults || []) {
            const content = msg?.content;
            let parsed: any = null;
            if (typeof content === "string") {
              try { parsed = JSON.parse(content); } catch { parsed = null; }
            } else if (content && typeof content === "object") {
              parsed = content;
            }
            if (!parsed) continue;
            if (typeof parsed.ok === "boolean") {
              turnLog.mutation_ok = parsed.ok && (turnLog.mutation_ok !== false);
            }
            if (typeof parsed.verified === "boolean") {
              turnLog.mutation_verified = parsed.verified && (turnLog.mutation_verified !== false);
            }
          }
        };


        // Phase 1.5: SSE heartbeat — keep the connection alive and prevent
        // perceived freezing during long tool execution / LLM round-trips.
        const heartbeat = setInterval(() => {
          try { enqueue(`: ping\n\n`); } catch { /* controller closed */ }
        }, 10_000);

        try {
          // Conversation history for multi-round tool calls
          const conversationMessages = [
            { role: "system", content: systemContent },
            ...messages,
          ];

          let currentResponse = response;
          let round = 0;
          const executionStart = Date.now();
          const toolHistory = new Set();
          let lastRoundHadToolCalls = false;
          let forcedRecoveryContent = "";

          while (true) {
            let { fullContent, toolCalls, finishReason, sawAnyDelta, sawContentDelta, sawToolDelta, hadIncompleteToolCall } = await consumeSSEStream(currentResponse, enqueue);
            lastFullContent = fullContent;
            aggregatedContent += fullContent;
            console.log("ROUND RESULT", {
              round,
              fullContentLength: fullContent.length,
              fullContentPreview: fullContent.slice(0, 200),
              toolCallsLength: toolCalls.length,
              finishReason,
              sawAnyDelta,
              sawContentDelta,
              sawToolDelta,
              hadIncompleteToolCall,
            });

            if ((!fullContent.trim() && toolCalls.length === 0) || hadIncompleteToolCall) {
              console.warn("EMPTY MODEL ROUND DETECTED", {
                round,
                finishReason,
                sawAnyDelta,
                sawContentDelta,
                sawToolDelta,
                hadIncompleteToolCall,
              });
              const recovery = await recoverEmptyCompletion(conversationMessages);

              // Phase 6: recovery is text-only. Never execute tool calls from
              // a recovery turn — they were not part of the user-visible stream.
              if (recovery.error) {
                turnLog.empty_completion = true;
                emitDuncanEvent({
                  duncan_event: "empty_completion",
                  error: recovery.error,
                });
              }

              forcedRecoveryContent = recovery.fullContent;
              lastFullContent = recovery.fullContent;
              aggregatedContent += recovery.fullContent;
              enqueue(`data: ${JSON.stringify({ choices: [{ delta: { content: recovery.fullContent } }] })}\n\n`);
              break;
            }

            const elapsedMs = Date.now() - executionStart;
            lastRoundHadToolCalls = !!toolCalls?.length;
            const signature = JSON.stringify(
              toolCalls.map(tc => ({
                name: tc?.function?.name,
                args: tc?.function?.arguments,
              }))
            );

            console.log(
              `Round ${round} streamed - content length: ${fullContent.length}, tool calls: ${toolCalls.length}`,
              toolCalls.map(tc => tc?.function?.name),
            );

            if (round > 0) {
              console.log("FINAL LLM OUTPUT:");
              console.log("fullContent:", fullContent);
              console.log("length:", fullContent?.length);
            }

            if (shouldBypassTools) {
              break;
            }

            if (!toolCalls || toolCalls.length === 0) {
              // Recovery: model sometimes emits the tool invocation as a JSON
              // text blob instead of a real OpenAI tool_call (e.g. printed
              // `{"tool_name":"generate_nda", ...}`). Detect and convert into
              // a real tool call so the downstream tool actually runs.
              const recoveredCall = (() => {
                try {
                  if (pendingNdaArgsFromHistory && (isNdaConfirmationReply || looksLikeNdaGenerationPromise(fullContent))) {
                    return {
                      id: `recovered_nda_${Date.now().toString(36)}`,
                      type: "function",
                      function: {
                        name: "generate_nda",
                        arguments: JSON.stringify(pendingNdaArgsFromHistory),
                      },
                    };
                  }
                  if (!fullContent) return null;
                  const firstBrace = fullContent.indexOf("{");
                  const lastBrace = fullContent.lastIndexOf("}");
                  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
                  const candidate = fullContent.slice(firstBrace, lastBrace + 1);
                  const parsed = JSON.parse(candidate);
                  if (!parsed || typeof parsed !== "object") return null;
                  const name = parsed.tool_name || parsed.toolName || parsed.name;
                  if (!name || typeof name !== "string") return null;
                  const exists = Array.isArray(filteredTools) && filteredTools.some(
                    (t: any) => t?.function?.name === name,
                  );
                  if (!exists) return null;
                  const { tool_name: _tn, toolName: _tnc, name: _n, ...args } = parsed;
                  return {
                    id: `recovered_${Date.now().toString(36)}`,
                    type: "function",
                    function: {
                      name,
                      arguments: JSON.stringify(args),
                    },
                  };
                } catch {
                  return null;
                }
              })();

              if (recoveredCall) {
                console.warn("RECOVERED TOOL CALL FROM TEXT CONTENT", {
                  name: recoveredCall.function.name,
                });
                toolCalls = [recoveredCall];
                // Suppress the leaked JSON from the assistant transcript so it
                // is not re-fed to the model in the next round.
                fullContent = "";
              } else {
                console.log("FINAL ANSWER — no tool calls");
                break;
              }
            }

            if (toolHistory.has(signature)) {
              console.warn("REPEATED TOOL CALL — stopping loop");
              break;
            }

            toolHistory.add(signature);

            if (round >= MAX_TOOL_ROUNDS || elapsedMs >= MAX_EXECUTION_TIME_MS) {
              if (round >= MAX_TOOL_ROUNDS) {
                console.warn("MAX TOOL ROUNDS REACHED — stopping loop");
              }
              if (elapsedMs >= MAX_EXECUTION_TIME_MS) {
                console.log(`Stopping tool loop after ${elapsedMs}ms due to hard execution limit`);
              }
              break;
            }

            round++;
            console.log(`Tool call round ${round}:`, toolCalls.map(tc => tc.function.name));

            // Phase 6 invariant: every tool call MUST have originated from the
            // streamed model output for this turn. consumeSSEStream is the only
            // producer; reject anything malformed before execution.
            const fabricated = toolCalls.filter((tc: any) =>
              !tc?.id || !tc?.function?.name || typeof tc?.function?.arguments !== "string"
            );
            if (fabricated.length > 0) {
              console.error("FABRICATED/MALFORMED TOOL CALL DETECTED — refusing to execute", {
                round,
                fabricated: fabricated.map((tc: any) => ({ id: tc?.id, name: tc?.function?.name })),
              });
              turnLog.fabricated_tool_call = true;
              emitDuncanEvent({
                duncan_event: "empty_completion",
                error: {
                  code: "fabricated_tool_call",
                  message: "Refused a tool call that did not originate from the streamed model output.",
                  retryable: true,
                },
              });
              break;
            }

            const provider = detectToolResultProvider(toolCalls);
            console.log("DETECTED PROVIDER:", {
              tool_id: toolCalls[0]?.id,
              detected: provider,
            });
            recordToolCalls(toolCalls);
            for (const tc of toolCalls) {
              const n = tc?.function?.name;
              if (n) turnLog.tools_called.push(n);
            }
            const toolResults = await executeToolCalls(toolCalls, provider, { emit: emitDuncanEvent });
            recordTurnToolOutcomes(toolResults);
            const generatedNdaResult = (() => {
              if (!toolCalls.some((tc: any) => tc?.function?.name === "generate_nda")) return null;
              for (const msg of toolResults || []) {
                const raw = msg?.content;
                let parsed: any = null;
                if (typeof raw === "string") {
                  try { parsed = JSON.parse(raw); } catch { parsed = null; }
                } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
                  parsed = raw;
                }
                if (parsed?.tool === "generate_nda" && parsed?.ok === true && parsed?.download_url) {
                  return parsed;
                }
              }
              return null;
            })();
            if (generatedNdaResult) {
              const ndaResponse = `## NDA generated\n\n[Download NDA](${generatedNdaResult.download_url})`;
              lastFullContent = ndaResponse;
              aggregatedContent += ndaResponse;
              forcedRecoveryContent = ndaResponse;
              enqueue(`data: ${JSON.stringify({ choices: [{ delta: { content: ndaResponse } }] })}\n\n`);
              break;
            }
            const toolResultsString = JSON.stringify(toolResults);
            const allToolResultsNoData = toolResults.length > 0 && toolResults.every((message: any) => {
              const content = message?.content;
              let normalized: any = null;
              if (typeof content === "string") {
                try {
                  normalized = JSON.parse(content);
                } catch {
                  normalized = null;
                }
              } else if (!Array.isArray(content)) {
                normalized = content;
              }

              const status = normalized?.status;
              return status === "no_data" || status === "partial";
            });

            if (!toolResultsString || toolResultsString.length < 10) {
              console.warn("EMPTY OR USELESS TOOL RESULT — stopping loop");
              break;
            }

            const assistantMsg: any = { role: "assistant", tool_calls: toolCalls };
            if (fullContent) {
              assistantMsg.content = fullContent;
            }

            conversationMessages.push(assistantMsg, ...toolResults);

            const isLastRound = round >= MAX_TOOL_ROUNDS;
            if (Date.now() - executionStart >= MAX_EXECUTION_TIME_MS) {
              console.log(`Stopping before follow-up LLM call due to hard execution limit`);
              break;
            }

            if (allToolResultsNoData) {
              console.log("ALL TOOL RESULTS WERE NO_DATA/PARTIAL — injecting strict no-speculation directive");
              conversationMessages.push({
                role: "system",
                content: "All tool calls returned no matching data. Respond with a brief, plain statement that you couldn't find the requested information in the connected sources, and (optionally) suggest one concrete next step the user can take (e.g. connect an integration, broaden the date range, check spelling). Do NOT invent meetings, emails, events, candidates, invoices, or any other records. Do NOT summarise hypothetical content. Do NOT call more tools.",
              });
            }
            console.log("FINAL LLM INPUT (last 3 messages):");
            console.log(JSON.stringify(conversationMessages.slice(-3), null, 2));
            currentResponse = await fetchAIWithRetry({
              model: CHAT_MODEL,
              messages: sanitizeConversationMessages(conversationMessages),
              stream: true,
              tools: filteredTools,
            });
            console.log("LLM RESPONSE RECEIVED:");
            console.log({
              hasBody: !!currentResponse?.body,
              status: currentResponse?.status,
            });

            if (!currentResponse.ok) {
              const text = await currentResponse.text();
              console.error(`Follow-up AI error (round ${round}):`, text);
              throw new Error("Failed to process tool results");
            }
          }

          // Log estimated token usage (approx 1 token per 4 chars)
          if (userId) {
            try {
              const estimatedPromptTokens = Math.ceil(JSON.stringify(messages).length / 4);
              const estimatedCompletionTokens = Math.ceil(aggregatedContent.length / 4);
              const estimatedTotal = estimatedPromptTokens + estimatedCompletionTokens;
              const today = new Date().toISOString().split("T")[0];

              const { data: existing } = await supabaseAdmin
                .from("token_usage")
                .select("id, prompt_tokens, completion_tokens, total_tokens, request_count")
                .eq("user_id", userId)
                .eq("usage_date", today)
                .maybeSingle();

              if (existing) {
                const newPrompt = existing.prompt_tokens + estimatedPromptTokens;
                const newCompletion = existing.completion_tokens + estimatedCompletionTokens;
                await supabaseAdmin
                  .from("token_usage")
                  .update({
                    prompt_tokens: newPrompt,
                    completion_tokens: newCompletion,
                    // Always derive total from prompt + completion to preserve the
                    // arithmetic invariant enforced by the DB CHECK constraint.
                    total_tokens: newPrompt + newCompletion,
                    request_count: existing.request_count + 1,
                  })
                  .eq("id", existing.id);
              } else {
                await supabaseAdmin
                  .from("token_usage")
                  .insert({
                    user_id: userId,
                    usage_date: today,
                    prompt_tokens: estimatedPromptTokens,
                    completion_tokens: estimatedCompletionTokens,
                    // Derived value — never written independently.
                    total_tokens: estimatedPromptTokens + estimatedCompletionTokens,
                    request_count: 1,
                  });
              }
            } catch (tokenErr) {
              console.error("Token usage logging error:", tokenErr);
            }
          }

          const needsFinalAnswer = !lastFullContent || lastFullContent.trim().length < 20;

          if (!forcedRecoveryContent && (lastRoundHadToolCalls || !lastFullContent || !aggregatedContent || aggregatedContent.trim().length < 20 || needsFinalAnswer)) {
            console.log("FORCING FINAL SYNTHESIS CALL");

            const finalMessages = sanitizeConversationMessages(conversationMessages);

            const finalResponse = await fetchAIWithRetry({
              messages: finalMessages,
              stream: true,
              tools: filteredTools,
            });

            const finalResult = await consumeSSEStream(finalResponse, enqueue);
            lastFullContent = finalResult.fullContent;

            if ((!lastFullContent.trim() && finalResult.toolCalls.length === 0) || finalResult.hadIncompleteToolCall) {
              console.warn("FINAL SYNTHESIS RETURNED EMPTY CONTENT", {
                finishReason: finalResult.finishReason,
                sawAnyDelta: finalResult.sawAnyDelta,
                sawContentDelta: finalResult.sawContentDelta,
                sawToolDelta: finalResult.sawToolDelta,
                hadIncompleteToolCall: finalResult.hadIncompleteToolCall,
              });
              const recovery = await recoverEmptyCompletion(finalMessages);
              if (recovery.error) {
                turnLog.empty_completion = true;
                emitDuncanEvent({
                  duncan_event: "empty_completion",
                  error: recovery.error,
                });
              }
              lastFullContent = recovery.fullContent;
              enqueue(`data: ${JSON.stringify({ choices: [{ delta: { content: recovery.fullContent } }] })}\n\n`);
            }
          }

          if (!lastFullContent.trim()) {
            lastFullContent = "I couldn’t complete the synthesis for this request. Please retry.";
            enqueue(`data: ${JSON.stringify({ choices: [{ delta: { content: lastFullContent } }] })}\n\n`);
          }

          // Phase 1.5: emit a compact "Sources used" footer for tool-grounded answers.
          // Skip voice mode (TTS) and briefing (already structured).
          const sourceEntries = Object.entries(sourcesUsed);
          if (sourceEntries.length > 0 && !isVoiceMode && mode !== "briefing") {
            const footer = `\n\n---\n**Sources used:** ${sourceEntries
              .map(([label, count]) => (count > 1 ? `${label} (${count})` : label))
              .join(" · ")}`;
            enqueue(`data: ${JSON.stringify({ choices: [{ delta: { content: footer } }] })}\n\n`);
          }

          // Phase 9.7: shadow-mode correctness linter. Logs violations only.
          try {
            const linterReport = lintAssistantDraft(
              lastFullContent || "",
              executedToolEnvelopes,
              "shadow",
            );
            (turnLog as any).correctness = {
              violations: linterReport.violations.length,
              kinds: linterReport.violations.map(v => v.kind),
              read_results: linterReport.readResultsSeen.length,
            };
            // Persist when one or more violations were detected so we can
            // query patterns without relying on edge-function log retention.
            if (linterReport.violations.length > 0) {
              try {
                const { error: persistErr } = await supabaseAdmin
                  .from("correctness_violations")
                  .insert({
                    user_id: userId ?? null,
                    turn_id: turnId,
                    model: CHAT_MODEL,
                    violation_count: linterReport.violations.length,
                    violation_kinds: linterReport.violations.map(v => v.kind),
                    violation_details: linterReport.violations,
                    read_results_seen: linterReport.readResultsSeen,
                    draft_preview: (lastFullContent || "").slice(0, 500),
                  });
                if (persistErr) {
                  console.warn("[correctness-linter] persist failed:", persistErr.message);
                }
              } catch (persistEx) {
                console.warn("[correctness-linter] persist threw:", persistEx);
              }
            }
          } catch (linterErr) {
            console.warn("[correctness-linter] failed:", linterErr);
          }

          console.log("FINAL RESPONSE SENT TO UI:");
          console.log({
            fullContentLength: lastFullContent?.length || 0,
            preview: lastFullContent?.slice(0, 200),
            sources: sourcesUsed,
          });

          // Phase 7: single structured per-turn log line.
          turnLog.rounds = round;
          console.info("[turn]", {
            ...turnLog,
            duration_ms: Date.now() - turnStartedAt,
            ok: true,
          });

          clearInterval(heartbeat);
          enqueue("data: [DONE]\n\n");
          controller.close();
        } catch (streamErr) {
          console.error("norman-chat streaming error:", streamErr);
          const message = streamErr instanceof Error ? streamErr.message : "Unknown streaming error";
          enqueue(`data: ${JSON.stringify({ choices: [{ delta: { content: `\n\n⚠️ Error: ${message}` } }] })}\n\n`);
          // Phase 7: structured per-turn log on failure path too.
          console.info("[turn]", {
            ...turnLog,
            duration_ms: Date.now() - turnStartedAt,
            ok: false,
            error: message,
          });
          clearInterval(heartbeat);
          enqueue("data: [DONE]\n\n");
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e: any) {
    console.error("norman-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
