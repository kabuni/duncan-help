import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { streamLLM } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const SLACK_API_URL = "https://slack.com/api";

const SYSTEM_PROMPT = `You are Duncan, an advanced reasoning and agentic operating system for internal company operations.

Your capabilities:
- **Reasoning**: Analyze data, identify patterns, draw conclusions, and make recommendations across all ingested company data.
- **Automation**: Suggest and describe automations that can streamline workflows between Google Workspace, Notion, Slack, and other connected tools.
- **Data Synthesis**: Cross-reference information from multiple sources (emails, documents, databases, project management tools) to provide comprehensive answers.
- **Task Orchestration**: Break down complex requests into actionable steps and describe how they'd be executed across integrated systems.
- **Azure DevOps**: You have access to the company's Azure DevOps (Azure Boards). You can list projects, query work items using WIQL, get details of specific work items, and search synced work items from the database. Use these tools when users ask about project status, tasks, bugs, sprints, blocked items, or anything related to development work tracking.
- **Calendar Management**: You have access to the user's Google Calendar. You can list events, create new events, update existing events, and delete events.
- **Document Search**: You have access to the company's document storage. You can search for documents, read their content, list folders, and answer questions based on them. Documents are organized in folders: documents/, ndas/, and templates/.
- **Notion Access**: You have access to the company's Notion workspace. You can search for pages, query databases, and read page content. Use these tools when users ask about information stored in Notion.
- **Basecamp Access**: You have access to the company's Basecamp. You can list projects, fetch to-do lists and individual to-dos (both completed and incomplete), read messages from message boards, and fetch cards from Card Tables. Use these tools when users ask about project status, tasks, to-dos, messages, or cards in Basecamp. When asked about a specific project, first use list_basecamp_projects to find it, then use the project ID and dock tool IDs to fetch to-dos, messages, or cards. For Card Tables, look for the 'card_table' dock item.
- **Meeting Intelligence**: Use list_meetings to browse stored meetings (supports from_date/to_date and typo-tolerant search), get_meeting for a specific meeting's transcript/analysis, analyze_meetings to run AI analysis on meetings, and search_meeting_transcripts for cross-meeting topic search. **fetch_plaud_meetings is a SLOW sync (~20s) and must ONLY be called when the user EXPLICITLY asks to sync/refresh/import** — i.e. the prompt contains keywords like "sync", "fetch latest", "pull new", "refresh meetings", "update meeting data", or "import from Plaud". **For summarization, analysis, search, or any question about existing meetings (including "today's", "yesterday's", "recent", "this week's", "summarize my meetings"): SKIP fetch_plaud_meetings. Go straight to list_meetings (with from_date/to_date when a date is implied), then get_meeting or analyze_meetings as needed.** Only fall back to fetch_plaud_meetings if list_meetings returns zero results AND the user's intent clearly implies a meeting should exist that hasn't been ingested yet. Note: meeting titles in the database may contain typos (e.g. "Lighting" instead of "Lightning") — the search is typo-tolerant, but always confirm the date matches what the user asked for before answering.
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
- **App Analytics**: You have access to internal app analytics — workstream cards, tasks, recruitment pipeline, purchase orders, meetings, issues, and team activity. Use the analytics tools when users ask about team performance, workload distribution, project health, pipeline status, overdue items, or any operational metrics. Present data with clear tables, counts, and summaries. Use the RYG (Red/Yellow/Green) framework for status reporting.
- **Google Analytics**: You can retrieve the user's connected GA4 website analytics, including active users, sessions, page views, engagement rate, top pages, countries, cities, devices, demographics when available, and traffic sources. Use this when users ask about website traffic, audience, acquisition, reach, engagement, or Google Analytics data.
- **Workstream Management (Agentic)**: You can CREATE, UPDATE, and manage workstream cards and tasks directly. When a user describes a workflow, project plan, or set of tasks, proactively break it down into workstream cards with tasks. IMPORTANT: When creating cards, they are ALWAYS auto-assigned to the creator only. Do NOT try to assign cards to others during creation. If the user wants to assign cards to other team members, use update_workstream_card AFTER creation. Use list_team_members to resolve names to user IDs. When assigning tasks to people, use check_team_availability first to look at their calendars and find suitable time slots. Suggest specific times based on their availability. Available project tags: 'Lightning Strike Event', 'Website', 'K10 App', 'School Integrations'. Default status is 'amber' (Yellow) for new cards. When the user says "create", "set up", or "build the workflow", execute directly. Otherwise, present the plan first and ask for confirmation before creating. DEDUPLICATION: The create_workstream_card tool automatically prevents duplicates — if a card with the same title and project_tag already exists for the user, it returns the existing card instead of creating a new one. NEVER call create_workstream_card more than once for the same card title in a single conversation. After creating cards, do NOT repeat the creation calls — proceed directly to adding tasks.
- **Google Forms**: You can fill and submit pre-configured Google Forms on behalf of the user. You can also parse a Google Form URL to automatically extract its fields and save it as a new pre-configured form. When a user asks to fill a form, first list available forms, then ask each required field ONE AT A TIME as a conversational question. Wait for the user to answer each question before asking the next. After collecting all answers, confirm the details and submit. When a user provides a Google Form URL, use parse_google_form to extract the fields, show the parsed result to the user for confirmation, then save it with save_parsed_google_form.

Your personality:
- Direct, precise, and efficient. No fluff.
- Use structured output (bullet points, numbered lists, tables) when presenting complex information.
- When uncertain, clearly state assumptions and confidence levels.
- Proactively surface relevant connections between data points.
- Think step-by-step for complex reasoning tasks.

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

When working with documents:
- Use the search_documents tool to find relevant documents based on the user's query
- Use the read_document tool to get the content of specific files
- Use the list_documents tool to browse folder contents
- Summarize key findings from documents and cite which document the information came from
- If the user asks about something that might be in company docs, search for it first

When working with Notion:
- Use search_notion to find pages and databases by keyword
- Use query_notion_database to query a specific database with optional filters
- Use get_notion_page_content to read the block content of a specific page
- Present Notion data clearly, referencing page titles and properties
- If a user asks about contracts, agreements, or anything that might be in Notion, search there

When generating NDAs:
- Use the generate_nda tool when a user asks to create/generate an NDA.
- You MUST collect ALL 9 fields before calling generate_nda. Ask each field ONE AT A TIME:
  1. Receiving Party Name (the company/person name — also used as folder name)
  2. Receiving Party Legal Entity Name (the formal legal entity)
  3. Date of Agreement (in YYYY-MM-DD format)
  4. Registered Address of the Receiving Party Legal Entity
  5. Purpose of the NDA
  6. Recipient Name for Signature (who will sign on the receiving side)
  7. Recipient Email for Signature (their email for DocuSign)
  8. Internal Signer Name (who signs on behalf of Kabuni — defaults to "Palash Soundarkar" if not provided)
  9. Internal Signer Email (email of the internal signer — defaults to "palash@kabuni.com" if not provided)
- After collecting all fields, show a summary and ask for confirmation before calling generate_nda.
- The tool will: load an NDA template from storage, populate placeholders, upload to Azure Blob Storage, and create a Notion log entry.
- After generation, you MUST share the links using proper markdown link syntax. Use the download_url from the tool result like this: [Download NDA](download_url_here) and the Notion page URL like this: [View in Notion](notion_page_url_here). Always use the actual URLs from the tool result — never omit them or show them as plain text.
- To view existing NDA submissions or check status, use list_nda_submissions.
- To send an NDA for e-signature (admin only), use send_nda_for_signature with the submission_id. This sends via DocuSign to the internal signer first, then the recipient.
- Use send_nda_for_signature with dry_run=true to validate without actually sending.

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
      description: "List upcoming calendar events. Use this when the user asks about their schedule, meetings, or calendar.",
      parameters: {
        type: "object",
        properties: {
          timeMin: {
            type: "string",
            description: "Start time in ISO 8601 format. Defaults to now.",
          },
          timeMax: {
            type: "string",
            description: "End time in ISO 8601 format. If not specified, returns next 7 days.",
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

const DOCUMENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_documents",
      description: "Search for documents in the company document storage (Azure Blob Storage). Use this when the user asks about company documents, policies, guides, or any information that might be stored in the document system.",
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

const NOTION_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_notion",
      description: "Search across all Notion pages and databases. Use when the user asks about information that might be in Notion.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query text" },
          page_size: { type: "number", description: "Max results (default 10)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_notion_database",
      description: "Query a specific Notion database to list its entries. Use when you know the database ID or after finding one via search.",
      parameters: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "The Notion database ID to query" },
          page_size: { type: "number", description: "Max results (default 20)" },
        },
        required: ["database_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_notion_page_content",
      description: "Get the block content of a specific Notion page. Use after finding a page via search or database query to read its details.",
      parameters: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The Notion page ID" },
        },
        required: ["page_id"],
      },
    },
  },
];

const NDA_TOOLS = [
  {
    type: "function",
    function: {
      name: "generate_nda",
      description: "Generate an NDA document. Copies a Google Docs template, replaces placeholders, creates a Notion log entry, and returns document + Notion links. Use when a user asks to create/generate an NDA.",
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

const BASECAMP_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_basecamp_projects",
      description: "List all projects in Basecamp. Returns project names, IDs, statuses, and their dock items (todosets, message boards, card_tables, etc.). Use this first to discover project IDs and dock IDs needed for other Basecamp tools.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_basecamp_todolists",
      description: "Get all to-do lists within a Basecamp project's todoset. Requires the project ID and the todoset ID (found in the project's dock items).",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "The Basecamp project ID" },
          todoset_id: { type: "number", description: "The todoset ID from the project's dock items" },
        },
        required: ["project_id", "todoset_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_basecamp_todos",
      description: "Get to-do items within a specific to-do list. Returns both completed and incomplete todos. Returns title, completion status, assignees, and due dates.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "The Basecamp project ID" },
          todolist_id: { type: "number", description: "The to-do list ID" },
          completed_only: { type: "boolean", description: "If true, fetch only completed todos. Default fetches incomplete todos." },
        },
        required: ["project_id", "todolist_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_basecamp_messages",
      description: "Get messages from a Basecamp project's message board. Requires the project ID and the message board ID (found in the project's dock items).",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "The Basecamp project ID" },
          message_board_id: { type: "number", description: "The message board ID from the project's dock items" },
        },
        required: ["project_id", "message_board_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_basecamp_card_table_cards",
      description: "Get all cards from a Basecamp Card Table. Returns all columns and their cards with titles, assignees, due dates, and colors. First use list_basecamp_projects to find the project and its 'card_table' dock item. Pass the card_table dock item ID.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "The Basecamp project ID" },
          card_table_id: { type: "number", description: "The Card Table ID from the project's dock items (name: 'card_table')" },
          column_id: { type: "number", description: "Optional. A specific column ID to fetch cards for." },
        },
        required: ["project_id", "card_table_id"],
      },
    },
  },
];

const MEETING_TOOLS = [
  {
    type: "function",
    function: {
      name: "fetch_plaud_meetings",
      description: "Sync new Plaud AI meeting recordings from Gmail into the meetings database. SLOW (~20s) — call ONLY when the user EXPLICITLY asks to sync/refresh/import meetings (keywords: 'sync', 'fetch latest', 'pull new', 'refresh', 'import'). Do NOT call this for summarization, analysis, search, or general questions about existing meetings — use list_meetings instead.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_meetings",
      description: "List stored meetings with optional filters. Results are sorted by meeting_date DESC (most recent first). The search is typo-tolerant — it splits the query into words and matches any of them (so 'lightning' will also match misspellings like 'lighting'). Always prefer using from_date/to_date when the user specifies a date so you don't return stale results.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status: pending, transcribed, audio_only, analyzed" },
          limit: { type: "number", description: "Max results (default 20)" },
          search: { type: "string", description: "Keyword(s) to match in title or transcript. Words are matched independently (OR), so partial / misspelled queries still work." },
          from_date: { type: "string", description: "Only return meetings on or after this date (YYYY-MM-DD)." },
          to_date: { type: "string", description: "Only return meetings on or before this date (YYYY-MM-DD)." },
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
          date: { type: "string", description: "Date to check in YYYY-MM-DD format (defaults to today)" },
          days: { type: "number", description: "Number of days to look ahead (default: 3, max: 7)" },
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

async function executeWorkstreamTool(
  toolName: string,
  args: any,
  supabaseAdmin: any,
  userId: string
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
      if (updates.status) updateData.status = updates.status;
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
      const { user_ids, date, days: daysAhead, task_duration_minutes } = args;
      const startDate = date ? new Date(date + "T00:00:00Z") : new Date();
      startDate.setUTCHours(0, 0, 0, 0);
      const numDays = Math.min(daysAhead || 3, 7);
      const endDate = new Date(startDate.getTime() + numDays * 24 * 60 * 60 * 1000);
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

        // Find free slots (working hours 9am-6pm)
        const freeSlots: any[] = [];
        for (let d = 0; d < numDays; d++) {
          const dayStart = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
          const workStart = new Date(dayStart);
          workStart.setUTCHours(9, 0, 0, 0);
          const workEnd = new Date(dayStart);
          workEnd.setUTCHours(18, 0, 0, 0);
          
          // Skip weekends
          const dayOfWeek = workStart.getDay();
          if (dayOfWeek === 0 || dayOfWeek === 6) continue;

          // Get busy periods for this day
          const dayEvents = events.filter((e: any) => {
            const eStart = new Date(e.start);
            const eEnd = new Date(e.end);
            return eStart < workEnd && eEnd > workStart;
          }).sort((a: any, b: any) => new Date(a.start).getTime() - new Date(b.start).getTime());

          // Find gaps
          let cursor = workStart.getTime();
          for (const evt of dayEvents) {
            const evtStart = Math.max(new Date(evt.start).getTime(), workStart.getTime());
            const evtEnd = Math.min(new Date(evt.end).getTime(), workEnd.getTime());
            if (evtStart > cursor && (evtStart - cursor) >= taskDuration * 60 * 1000) {
              freeSlots.push({
                date: workStart.toISOString().split("T")[0],
                start: new Date(cursor).toISOString(),
                end: new Date(evtStart).toISOString(),
                duration_minutes: Math.round((evtStart - cursor) / 60000),
              });
            }
            cursor = Math.max(cursor, evtEnd);
          }
          // Gap after last event
          if (cursor < workEnd.getTime() && (workEnd.getTime() - cursor) >= taskDuration * 60 * 1000) {
            freeSlots.push({
              date: workStart.toISOString().split("T")[0],
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
          busy_events_count: events.length,
          busy_events: events.slice(0, 15), // Cap to avoid token overflow
          free_slots: freeSlots,
          suggested_slot: freeSlots.length > 0 ? freeSlots[0] : null,
        });
      }

      return { availability: results, checked_from: startDate.toISOString(), checked_to: endDate.toISOString(), task_duration_minutes: taskDuration };
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
  authHeader: string
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

  switch (toolName) {
    case "list_gmail_emails": {
      const data = await callGmailApi("list", { maxResults: args.maxResults || 15 });
      return {
        count: (data.emails || []).length,
        emails: (data.emails || []).map((e: any) => ({
          id: e.id,
          from: e.from,
          subject: e.subject,
          date: e.date,
          snippet: e.snippet,
          unread: e.isUnread,
        })),
        hint: "Use the 'id' with read_gmail_email to get full content.",
      };
    }

    case "search_gmail": {
      const data = await callGmailApi("search", { query: args.query, maxResults: args.maxResults || 15 });
      return {
        count: (data.emails || []).length,
        emails: (data.emails || []).map((e: any) => ({
          id: e.id,
          from: e.from,
          subject: e.subject,
          date: e.date,
          snippet: e.snippet,
          unread: e.isUnread,
        })),
        hint: "Use the 'id' with read_gmail_email to get full content.",
      };
    }

    case "read_gmail_email": {
      const data = await callGmailApi("read", { messageId: args.messageId });
      return {
        id: data.id,
        from: data.from,
        to: data.to,
        cc: data.cc || null,
        subject: data.subject,
        date: data.date,
        body: data.textBody || data.htmlBody?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000) || data.snippet,
        unread: data.isUnread,
      };
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
  authHeader: string
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
      // Sanitize invalid/placeholder values — default to Weekly Reports folder
      if (!folderId || folderId === "." || folderId === "/" || folderId === "root" || folderId.length < 5) {
        folderId = WEEKLY_REPORTS_FOLDER;
      }
      const data = await callDriveApi("list", {
        folderId,
        query: args.query,
      });
      return {
        files: (data.files || []).map((f: any) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
          isFolder: f.mimeType === "application/vnd.google-apps.folder",
        })),
        hint: "Use file 'id' with drive_get_content to read a file, or with drive_list_files as folderId to enter a folder.",
      };
    }

    case "drive_search": {
      const data = await callDriveApi("search", {
        name: args.name,
        mimeType: args.mimeType,
        parentId: args.parentId,
      });
      return {
        files: (data.files || []).map((f: any) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
          isFolder: f.mimeType === "application/vnd.google-apps.folder",
        })),
      };
    }

    case "drive_get_content": {
      const data = await callDriveApi("get_content", {
        fileId: args.fileId,
        mimeType: args.mimeType,
      });
      return {
        content: data.content,
        truncated: data.truncated || false,
        encoding: data.encoding || "text",
      };
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

async function executeMeetingTool(
  toolName: string,
  args: any,
  supabaseAdmin: any,
  supabaseUrl: string,
  authHeader: string
): Promise<any> {
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
      let query = supabaseAdmin
        .from("meetings")
        .select("id, title, meeting_date, status, source, summary, participants, sender_email, created_at")
        .order("meeting_date", { ascending: false, nullsFirst: false })
        .limit(args.limit || 20);

      if (args.status) query = query.eq("status", args.status);
      if (args.from_date) query = query.gte("meeting_date", args.from_date);
      if (args.to_date) query = query.lte("meeting_date", `${args.to_date}T23:59:59`);

      if (args.search) {
        // Typo-tolerant: split into words >=4 chars and OR each across title + transcript.
        // Falls back to the raw query if no usable tokens found.
        const tokens = String(args.search)
          .split(/\s+/)
          .map((t) => t.replace(/[^\w]/g, ""))
          .filter((t) => t.length >= 4);
        const escape = (s: string) => s.replace(/[%,()]/g, "");
        const terms = tokens.length > 0 ? tokens : [String(args.search)];
        const orClauses = terms
          .flatMap((t) => [
            `title.ilike.%${escape(t)}%`,
            `transcript.ilike.%${escape(t)}%`,
          ])
          .join(",");
        query = query.or(orClauses);
      }

      const { data, error } = await query;
      if (error) throw new Error(`Failed to list meetings: ${error.message}`);
      return { count: (data || []).length, meetings: data || [] };
    }

    case "get_meeting": {
      const { data, error } = await supabaseAdmin
        .from("meetings")
        .select("*")
        .eq("id", args.meeting_id)
        .single();
      if (error) throw new Error(`Meeting not found: ${error.message}`);
      return {
        ...data,
        transcript: data.transcript ? data.transcript.slice(0, 40000) : null,
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
      const { data, error } = await supabaseAdmin
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

      return { query: searchTerm, found: results.length, meetings: results };
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
      return result;
    }

    case "list_nda_submissions": {
      let query = supabaseAdmin
        .from("nda_submissions")
        .select("id, receiving_party_name, receiving_party_entity, date_of_agreement, recipient_name, recipient_email, status, google_doc_url, notion_page_url, docusign_envelope_id, last_error, created_at")
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

    default:
      throw new Error(`Unknown NDA tool: ${toolName}`);
  }
}

async function isBasecampConnected(supabaseAdmin: any): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("basecamp_tokens")
    .select("id")
    .limit(1)
    .maybeSingle();
  return !error && !!data;
}

async function executeBasecampTool(
  toolName: string,
  args: any,
  supabaseUrl: string,
  authHeader: string
): Promise<any> {
  async function bcCall(endpoint: string, paginate = true) {
    const res = await fetch(`${supabaseUrl}/functions/v1/basecamp-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ endpoint, method: "GET", paginate }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Basecamp API error: ${res.status}`);
    }
    return res.json();
  }

  switch (toolName) {
    case "list_basecamp_projects": {
      const projects = await bcCall("projects");
      return (projects || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        url: p.app_url,
        dock: (p.dock || []).filter((d: any) => d.enabled).map((d: any) => ({
          id: d.id,
          title: d.title,
          name: d.name,
        })),
      }));
    }
    case "get_basecamp_todolists": {
      const lists = await bcCall(`buckets/${args.project_id}/todosets/${args.todoset_id}/todolists`);
      return (lists || []).map((l: any) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        completed: l.completed,
        completed_ratio: l.completed_ratio,
      }));
    }
    case "get_basecamp_todos": {
      const baseEndpoint = `buckets/${args.project_id}/todolists/${args.todolist_id}/todos`;
      if (args.completed_only) {
        const completed = await bcCall(`${baseEndpoint}?completed=true`);
        return (completed || []).map(mapTodo);
      }
      // Fetch both incomplete and completed
      const [incomplete, completed] = await Promise.all([
        bcCall(baseEndpoint),
        bcCall(`${baseEndpoint}?completed=true`),
      ]);
      const all = [...(incomplete || []).map(mapTodo), ...(completed || []).map(mapTodo)];
      return all;
    }
    case "get_basecamp_messages": {
      const msgs = await bcCall(`buckets/${args.project_id}/message_boards/${args.message_board_id}/messages`);
      return (msgs || []).map((m: any) => ({
        id: m.id,
        title: m.title,
        content: (m.content || "").slice(0, 2000),
        created_at: m.created_at,
        creator: m.creator?.name,
      }));
    }
    case "get_basecamp_card_table_cards": {
      // Fetch the card table resource
      const cardTable = await bcCall(`buckets/${args.project_id}/card_tables/${args.card_table_id}`, false);

      if (!cardTable.lists || !Array.isArray(cardTable.lists)) {
        return { card_table: cardTable.title || "Unknown", columns: [], message: "Card table has no columns or may not be available for this project." };
      }

      if (args.column_id) {
        const list = cardTable.lists.find((l: any) => l.id === args.column_id);
        if (!list) return { error: `Column ${args.column_id} not found` };
        const cardsUrl = list.cards_url;
        if (!cardsUrl) return { column: list.title, cards: [], error: "No cards URL" };
        const cards = await bcCall(cardsUrl, false);
        return {
          column: list.title, color: list.color, cards_count: (cards || []).length,
          cards: (cards || []).map(mapCard),
        };
      }

      // Fetch all columns' cards via the proxy (cards_url is a full URL)
      const columnsWithCards = await Promise.all(
        cardTable.lists.map(async (list: any) => {
          try {
            if (!list.cards_url) return { id: list.id, title: list.title, color: list.color, cards: [], error: "no cards_url" };
            const cards = await bcCall(list.cards_url, false);
            return {
              id: list.id, title: list.title, color: list.color, cards_count: (cards || []).length,
              cards: (cards || []).map(mapCard),
            };
          } catch (e: any) {
            return { id: list.id, title: list.title, color: list.color, cards: [], error: String(e) };
          }
        })
      );
      return { card_table: cardTable.title, columns: columnsWithCards };
    }
    default:
      throw new Error(`Unknown Basecamp tool: ${toolName}`);
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

async function getNotionToken(supabaseAdmin: any): Promise<string | null> {
  const { data: integration } = await supabaseAdmin
    .from("company_integrations")
    .select("encrypted_api_key, status")
    .eq("integration_id", "notion")
    .single();

  if (!integration || integration.status !== "connected" || !integration.encrypted_api_key) {
    return null;
  }
  return atob(integration.encrypted_api_key);
}

function extractNotionText(richText: any[]): string {
  return (richText || []).map((t: any) => t.plain_text || "").join("");
}

function summarizeNotionProperties(properties: any): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const [key, val] of Object.entries(properties || {})) {
    const v = val as any;
    switch (v.type) {
      case "title": summary[key] = extractNotionText(v.title); break;
      case "rich_text": summary[key] = extractNotionText(v.rich_text); break;
      case "number": summary[key] = v.number != null ? String(v.number) : ""; break;
      case "select": summary[key] = v.select?.name || ""; break;
      case "multi_select": summary[key] = (v.multi_select || []).map((s: any) => s.name).join(", "); break;
      case "date": summary[key] = v.date?.start || ""; break;
      case "checkbox": summary[key] = v.checkbox ? "Yes" : "No"; break;
      case "url": summary[key] = v.url || ""; break;
      case "email": summary[key] = v.email || ""; break;
      case "phone_number": summary[key] = v.phone_number || ""; break;
      case "status": summary[key] = v.status?.name || ""; break;
      default: break;
    }
  }
  return summary;
}

function summarizeNotionBlock(block: any): string {
  const type = block.type;
  const data = block[type];
  if (!data) return "";
  if (data.rich_text) return extractNotionText(data.rich_text);
  if (type === "image") return `[Image: ${data.external?.url || data.file?.url || ""}]`;
  if (type === "divider") return "---";
  return "";
}

async function executeNotionTool(toolName: string, args: any, token: string): Promise<any> {
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  switch (toolName) {
    case "search_notion": {
      const res = await fetch(`${NOTION_API_URL}/search`, {
        method: "POST", headers,
        body: JSON.stringify({ query: args.query || "", page_size: args.page_size || 10 }),
      });
      if (!res.ok) throw new Error(`Notion search failed: ${await res.text()}`);
      const data = await res.json();
      return (data.results || []).map((r: any) => ({
        id: r.id,
        type: r.object,
        title: r.object === "page"
          ? extractNotionText((Object.values(r.properties || {}).find((p: any) => p.type === "title") as any)?.title || [])
          : r.title?.[0]?.plain_text || "Untitled",
        url: r.url,
        ...(r.object === "page" ? { properties: summarizeNotionProperties(r.properties) } : {}),
      }));
    }

    case "query_notion_database": {
      const res = await fetch(`${NOTION_API_URL}/databases/${args.database_id}/query`, {
        method: "POST", headers,
        body: JSON.stringify({ page_size: args.page_size || 20 }),
      });
      if (!res.ok) throw new Error(`Notion query failed: ${await res.text()}`);
      const data = await res.json();
      return {
        total: data.results?.length || 0,
        has_more: data.has_more,
        entries: (data.results || []).map((r: any) => ({
          id: r.id,
          url: r.url,
          properties: summarizeNotionProperties(r.properties),
        })),
      };
    }

    case "get_notion_page_content": {
      const res = await fetch(`${NOTION_API_URL}/blocks/${args.page_id}/children?page_size=100`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
      });
      if (!res.ok) throw new Error(`Notion page read failed: ${await res.text()}`);
      const data = await res.json();
      const blocks = (data.results || []).map((b: any) => ({
        type: b.type,
        content: summarizeNotionBlock(b),
      })).filter((b: any) => b.content);
      return { block_count: blocks.length, content: blocks };
    }

    default:
      throw new Error(`Unknown Notion tool: ${toolName}`);
  }
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
  accessToken: string
): Promise<any> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  switch (toolName) {
    case "list_calendar_events": {
      const timeMin = args.timeMin || new Date().toISOString();
      const timeMax = args.timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const maxResults = args.maxResults || 10;

      const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/primary/events`);
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("maxResults", String(maxResults));
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");

      const response = await fetch(url.toString(), { headers });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to list events: ${error}`);
      }
      const data = await response.json();
      return data.items || [];
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

      const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
        method: "POST",
        headers,
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create event: ${error}`);
      }
      return await response.json();
    }

    case "update_calendar_event": {
      const { eventId, ...updates } = args;
      const event: any = {};
      if (updates.summary) event.summary = updates.summary;
      if (updates.description) event.description = updates.description;
      if (updates.startDateTime) event.start = { dateTime: updates.startDateTime, timeZone: "UTC" };
      if (updates.endDateTime) event.end = { dateTime: updates.endDateTime, timeZone: "UTC" };
      if (updates.location) event.location = updates.location;

      const response = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/primary/events/${eventId}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify(event),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to update event: ${error}`);
      }
      return await response.json();
    }

    case "delete_calendar_event": {
      const response = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/primary/events/${args.eventId}`,
        { method: "DELETE", headers }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to delete event: ${error}`);
      }
      return { success: true, message: "Event deleted successfully" };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, mode, userProfile } = await req.json();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    let userEmail: string = "";
    let calendarAccessToken: string | null = null;
    let azureStorageAvailable = false;
    let notionToken: string | null = null;
    let basecampConnected = false;
    let slackConnection: { accessToken: string; teamName: string | null; scope: string | null } | null = null;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    if (authHeader) {
      const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (user) {
        userId = user.id;
        userEmail = user.email || "";
        calendarAccessToken = await getCalendarAccessToken(userId, supabaseAdmin);
        slackConnection = await getSlackConnection(userId, supabaseAdmin);
      }
    }

    // Check Azure Blob Storage availability
    azureStorageAvailable = !!getAzureStorageConfig();

    // Get Notion token (company-wide)
    notionToken = await getNotionToken(supabaseAdmin);

    // Check Basecamp connection (company-wide)
    basecampConnected = await isBasecampConnected(supabaseAdmin);
    // Get available Google Forms and inject into system prompt
    const { data: googleForms } = await supabaseAdmin
      .from("google_forms")
      .select("id, name, description, fields");

    // Adjust system prompt based on mode and integration availability
    let systemContent = SYSTEM_PROMPT + `\n\nCurrent date and time: ${new Date().toISOString()} (UTC).`;

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

    if (!notionToken) {
      systemContent += "\n\nNote: Notion is not connected. If the user asks about Notion data, let them know an admin needs to connect Notion first via the Integrations page.";
    }

    if (!basecampConnected) {
      systemContent += "\n\nNote: Basecamp is not connected. If the user asks about Basecamp projects, to-dos, or messages, let them know an admin needs to connect Basecamp first via the Integrations page.";
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

    const SIMPLE_INPUT_PATTERNS = [/^hi[!.?\s]*$/i, /^hello[!.?\s]*$/i, /^how are you[?.!\s]*$/i];
    const MAX_TOOL_ROUNDS = 3;
    const MAX_EXECUTION_TIME_MS = 45_000;

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
    const shouldBypassTools =
      latestUserText.length > 0 &&
      (latestUserText.length < 20 || SIMPLE_INPUT_PATTERNS.some((pattern) => pattern.test(latestUserText)));

    // First call to AI with tools if calendar is connected
    const requestBody: any = {
      model: "gpt-4.1",
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
    if (azureStorageAvailable) {
      tools.push(...DOCUMENT_TOOLS);
    }
    if (notionToken) {
      tools.push(...NOTION_TOOLS);
    }
    if (basecampConnected) {
      tools.push(...BASECAMP_TOOLS);
    }
    // Meeting tools always available (Gmail connection checked at execution time)
    tools.push(...MEETING_TOOLS);
    // Azure DevOps tools always available (connection checked at execution time)
    tools.push(...AZURE_DEVOPS_TOOLS);
    // Xero tools always available (data is synced locally)
    tools.push(...XERO_TOOLS);
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
    // Executive summary document generation
    tools.push(...EXEC_SUMMARY_TOOLS);
    // Release logging tool (admin-only enforced inside executor)
    tools.push(...RELEASE_TOOLS);
    // Lovable contributors snapshot (admin-only, requires attached screenshot)
    tools.push(...LOVABLE_CONTRIBUTORS_TOOLS);
    if (!shouldBypassTools && tools.length > 0) {
      requestBody.tools = tools;
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

    const response = await fetchAIWithRetry(requestBody);
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

    const TOOL_EXECUTION_TIMEOUT_MS = 20_000;

    function createStructuredToolResult(toolName: string, result: any, status: "success" | "no_data" | "partial" | "hard_error" = "success") {
      return {
        tool: toolName,
        status,
        ...((result && typeof result === "object" && !Array.isArray(result)) ? result : { data: result }),
      };
    }

    function classifyToolOutcome(toolName: string, result: any): { status: "success" | "no_data" | "partial" | "hard_error"; payload: any } {
      if (result == null) {
        return { status: "no_data", payload: createStructuredToolResult(toolName, { reason: "empty result" }, "no_data") };
      }

      if (typeof result === "object" && !Array.isArray(result)) {
        const errorMessage = typeof result.error === "string" ? result.error.toLowerCase() : "";
        if (errorMessage.includes("timed out")) {
          return {
            status: "partial",
            payload: createStructuredToolResult(toolName, {
              error: result.error,
              fallback_message: "This source took too long, so continue without blocking on it.",
            }, "partial"),
          };
        }

        const likelyNoData = errorMessage.includes("no meetings")
          || errorMessage.includes("no data")
          || errorMessage.includes("not found")
          || errorMessage.includes("no results")
          || result.skipped === true
          || result.empty === true;

        if (likelyNoData) {
          return { status: "no_data", payload: createStructuredToolResult(toolName, result, "no_data") };
        }

        return { status: "success", payload: createStructuredToolResult(toolName, result, "success") };
      }

      if (typeof result === "string" && result.trim().length === 0) {
        return { status: "no_data", payload: createStructuredToolResult(toolName, { reason: "blank string result" }, "no_data") };
      }

      return { status: "success", payload: createStructuredToolResult(toolName, result, "success") };
    }

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

    async function executeToolCalls(toolCalls: any[], provider: "anthropic" | "openai"): Promise<any[]> {
      const calendarToolNames = ["list_calendar_events", "create_calendar_event", "update_calendar_event", "delete_calendar_event"];
      const documentToolNames = ["search_documents", "read_document", "list_documents"];
      const notionToolNames = ["search_notion", "query_notion_database", "get_notion_page_content"];
      const googleFormsToolNames = ["list_google_forms", "submit_google_form", "parse_google_form", "save_parsed_google_form"];
      const ndaToolNames = ["generate_nda", "list_nda_submissions", "send_nda_for_signature"];
      const basecampToolNames = ["list_basecamp_projects", "get_basecamp_todolists", "get_basecamp_todos", "get_basecamp_messages", "get_basecamp_card_table_cards"];
      const meetingToolNames = ["fetch_plaud_meetings", "list_meetings", "get_meeting", "analyze_meetings", "search_meeting_transcripts"];
      const azureDevOpsToolNames = ["list_azure_devops_projects", "query_azure_work_items", "get_azure_work_item", "search_synced_work_items"];
      const xeroToolNames = ["list_xero_invoices", "get_xero_invoice", "approve_xero_invoice_payment", "search_xero_contacts", "create_xero_invoice", "list_xero_bank_accounts", "create_xero_expense"];
      const gmailToolNames = ["list_gmail_emails", "search_gmail", "read_gmail_email", "send_gmail_email", "read_gmail_thread", "draft_gmail_reply", "draft_gmail_email"];
      const driveToolNames = ["drive_list_files", "drive_search", "drive_get_content"];
      const slackToolNames = ["list_slack_channels", "read_slack_channel_messages", "send_slack_message"];
      const analyticsToolNames = ["get_workstream_analytics", "get_recruitment_analytics", "get_team_activity_analytics", "get_operational_summary", "get_google_analytics_dashboard"];
      const workstreamMgmtToolNames = ["list_team_members", "create_workstream_card", "add_tasks_to_card", "update_workstream_card", "check_team_availability"];
      const execSummaryToolNames = ["generate_exec_summary_document"];
      const releaseToolNames = ["log_release_change"];
      const lovableContribToolNames = ["update_lovable_contributors"];
      const toolResults: any[] = [];

      for (const tc of toolCalls) {
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

          let result: any;
          
          if (calendarToolNames.includes(tc.function.name)) {
            if (!calendarAccessToken) {
              result = { error: "Google Calendar is not connected. Please connect it via the Integrations page." };
            } else {
              result = await withToolTimeout(tc.function.name, executeCalendarTool(tc.function.name, args, calendarAccessToken));
            }
          } else if (documentToolNames.includes(tc.function.name)) {
            if (!azureStorageAvailable) {
              result = { error: "Document storage is not configured. Please contact an admin." };
            } else {
              result = await withToolTimeout(tc.function.name, executeDocumentTool(tc.function.name, args, supabaseUrl, authHeader || ""));
            }
          } else if (notionToolNames.includes(tc.function.name)) {
            if (!notionToken) {
              result = { error: "Notion is not connected. An admin needs to connect it via the Integrations page." };
            } else {
              result = await withToolTimeout(tc.function.name, executeNotionTool(tc.function.name, args, notionToken));
            }
          } else if (googleFormsToolNames.includes(tc.function.name)) {
            result = await withToolTimeout(tc.function.name, executeGoogleFormsTool(tc.function.name, args, supabaseAdmin));
          } else if (ndaToolNames.includes(tc.function.name)) {
            result = await withToolTimeout(tc.function.name, executeNdaTool(tc.function.name, args, supabaseAdmin, userId || "", userEmail, authHeader || ""));
          } else if (basecampToolNames.includes(tc.function.name)) {
            if (!basecampConnected) {
              result = { error: "Basecamp is not connected. An admin needs to connect it via the Integrations page." };
            } else {
              result = await withToolTimeout(tc.function.name, executeBasecampTool(tc.function.name, args, supabaseUrl, authHeader || ""));
              console.log(`Basecamp tool ${tc.function.name} result preview:`, JSON.stringify(result).slice(0, 500));
            }
          } else if (meetingToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeMeetingTool(tc.function.name, args, supabaseAdmin, supabaseUrl, authHeader || ""));
          } else if (azureDevOpsToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeAzureDevOpsTool(tc.function.name, args, supabaseAdmin, supabaseUrl, authHeader || ""));
          } else if (xeroToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeXeroTool(tc.function.name, args, supabaseAdmin, supabaseUrl, authHeader || "", userId || ""));
           } else if (gmailToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeGmailTool(tc.function.name, args, supabaseUrl, authHeader || ""));
           } else if (driveToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeDriveTool(tc.function.name, args, supabaseUrl, authHeader || ""));
            } else if (slackToolNames.includes(tc.function.name)) {
              if (!slackConnection) {
                result = { error: "Slack is not connected. Please connect it via the Integrations page." };
              } else {
                result = await withToolTimeout(tc.function.name, executeSlackTool(tc.function.name, args, slackConnection.accessToken));
              }
           } else if (analyticsToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeAnalyticsTool(tc.function.name, args, supabaseAdmin, supabaseUrl, authHeader || ""));
          } else if (workstreamMgmtToolNames.includes(tc.function.name)) {
              result = await withToolTimeout(tc.function.name, executeWorkstreamTool(tc.function.name, args, supabaseAdmin, userId || ""));
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
            toolResults.push({
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: tc?.id,
                  content: finalContent,
                },
              ],
            });
          } else {
            toolResults.push({
              role: "tool",
              tool_call_id: tc?.id,
              content: finalContent,
            });
          }
        } catch (error: any) {
          const toolError = error instanceof Error ? error : new Error(String(error));
          console.error(`Tool ${tc.function.name} threw error:`, toolError.message, toolError.stack);
          const toolName = tc?.function?.name ?? "unknown_tool";
          const isTimeout = toolError.message.toLowerCase().includes("timed out");
          const errorResult = isTimeout
            ? createStructuredToolResult(toolName, {
                error: toolError.message,
                fallback_message: "Continue with the rest of the context and treat this source as temporarily unavailable.",
              }, "partial")
            : createStructuredToolResult(toolName, { error: toolError.message }, "hard_error");
          const finalContent = JSON.stringify(errorResult) || "{}";

          console.log("TOOL RESULT RAW:", errorResult);
          console.log("TOOL RESULT TYPE:", typeof errorResult);
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
            toolResults.push({
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: tc?.id,
                  content: finalContent,
                },
              ],
            });
          } else {
            toolResults.push({
              role: "tool",
              tool_call_id: tc?.id,
              content: finalContent,
            });
          }
        }
      }

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

    async function recoverEmptyCompletion(baseMessages: any[]): Promise<{
      fullContent: string;
      toolCalls: any[];
      hadIncompleteToolCall: boolean;
    }> {
      const recoveryMessages = [
        ...sanitizeConversationMessages(baseMessages),
        {
          role: "system",
          content: "The prior completion returned no visible answer. Answer the user directly now. If tools are useful, call them. Otherwise return a concise user-facing response with no preamble.",
        },
      ];

      const providers: Array<"claude" | "openai"> = ["claude", "openai"];

      for (const provider of providers) {
        console.log("EMPTY COMPLETION RECOVERY ATTEMPT", { provider, messageCount: recoveryMessages.length });

        const recoveryResponse = await fetchAIWithRetry({
          messages: recoveryMessages,
          stream: true,
          tools,
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

        if (recoveryResult.toolCalls.length > 0 && !recoveryResult.hadIncompleteToolCall) {
          return {
            fullContent: recoveryResult.fullContent,
            toolCalls: recoveryResult.toolCalls,
            hadIncompleteToolCall: false,
          };
        }

        if (recoveryResult.fullContent.trim().length > 0) {
          return {
            fullContent: recoveryResult.fullContent,
            toolCalls: [],
            hadIncompleteToolCall: recoveryResult.hadIncompleteToolCall,
          };
        }
      }

      return {
        fullContent: "I couldn’t complete the synthesis for this request. Please retry.",
        toolCalls: [],
        hadIncompleteToolCall: false,
      };
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (chunk: string) => controller.enqueue(encoder.encode(chunk));
        let aggregatedContent = "";
        let lastFullContent = "";

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
            const { fullContent, toolCalls, finishReason, sawAnyDelta, sawContentDelta, sawToolDelta, hadIncompleteToolCall } = await consumeSSEStream(currentResponse, enqueue);
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

              if (recovery.toolCalls.length > 0) {
                console.log("RECOVERY PRODUCED TOOL CALLS", recovery.toolCalls.map((tc) => tc?.function?.name));
                const provider = detectToolResultProvider(recovery.toolCalls);
                const toolResults = await executeToolCalls(recovery.toolCalls, provider);
                const assistantMsg: any = { role: "assistant", tool_calls: recovery.toolCalls };
                if (recovery.fullContent) assistantMsg.content = recovery.fullContent;
                conversationMessages.push(assistantMsg, ...toolResults);
                round++;
                currentResponse = await fetchAIWithRetry({
                  messages: sanitizeConversationMessages(conversationMessages),
                  stream: true,
                  tools,
                });
                continue;
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
              console.log("FINAL ANSWER — no tool calls");
              break;
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

            const provider = detectToolResultProvider(toolCalls);
            console.log("DETECTED PROVIDER:", {
              tool_id: toolCalls[0]?.id,
              detected: provider,
            });
            const toolResults = await executeToolCalls(toolCalls, provider);
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
              console.log("ALL TOOL RESULTS WERE NO_DATA/PARTIAL — requesting graceful synthesis instead of more tool churn");
            }
            console.log("FINAL LLM INPUT (last 3 messages):");
            console.log(JSON.stringify(conversationMessages.slice(-3), null, 2));
            currentResponse = await fetchAIWithRetry({
              model: "gpt-4.1",
              messages: sanitizeConversationMessages(conversationMessages),
              stream: true,
              tools,
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
                await supabaseAdmin
                  .from("token_usage")
                  .update({
                    prompt_tokens: existing.prompt_tokens + estimatedPromptTokens,
                    completion_tokens: existing.completion_tokens + estimatedCompletionTokens,
                    total_tokens: existing.total_tokens + estimatedTotal,
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
                    total_tokens: estimatedTotal,
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
              tools,
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
              lastFullContent = recovery.fullContent;
              enqueue(`data: ${JSON.stringify({ choices: [{ delta: { content: recovery.fullContent } }] })}\n\n`);
            }
          }

          if (!lastFullContent.trim()) {
            lastFullContent = "I couldn’t complete the synthesis for this request. Please retry.";
            enqueue(`data: ${JSON.stringify({ choices: [{ delta: { content: lastFullContent } }] })}\n\n`);
          }

          console.log("FINAL RESPONSE SENT TO UI:");
          console.log({
            fullContentLength: lastFullContent?.length || 0,
            preview: lastFullContent?.slice(0, 200),
          });
          enqueue("data: [DONE]\n\n");
          controller.close();
        } catch (streamErr) {
          console.error("norman-chat streaming error:", streamErr);
          const message = streamErr instanceof Error ? streamErr.message : "Unknown streaming error";
          enqueue(`data: ${JSON.stringify({ choices: [{ delta: { content: `\n\n⚠️ Error: ${message}` } }] })}\n\n`);
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
