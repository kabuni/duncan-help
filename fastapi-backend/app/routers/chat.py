"""
norman-chat and project-context chat routes.
Real tables: chats, chat_messages, cards, projects, file_chunks, file_embeddings
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional, AsyncIterator
import uuid

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.services.llm import CallLLMOptions, stream_llm, call_llm_with_fallback
from app.services.embeddings import embed_text

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])

MAX_TOOL_ROUNDS = 5
CONTEXT_MESSAGES = 20

SSE_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Cache-Control": "no-cache",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
}


class ChatMessage(BaseModel):
    role: str
    content: str


class NormanChatRequest(BaseModel):
    messages: list[ChatMessage]
    chat_id: Optional[str] = None
    attachments: Optional[list[dict]] = None


class ProjectChatRequest(BaseModel):
    messages: list[ChatMessage]
    project_id: str
    chat_id: Optional[str] = None
    attachments: Optional[list[dict]] = None


<<<<<<< HEAD
=======
class SimpleProjectChatRequest(BaseModel):
    chat_id: str
    message: str
    attachments: Optional[list[dict]] = None


>>>>>>> 811253bb (UI Layer Integration)
class GenerateTitleRequest(BaseModel):
    messages: list[ChatMessage]


def _build_system_prompt(user: dict) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    name = user.get("full_name") or user.get("email", "").split("@")[0]
    role_title = user.get("role_title") or ""
    department = user.get("department") or ""

    return f"""You are Duncan, Kabuni's internal AI assistant. You have access to tools that let you read and write across all Kabuni's internal systems.

Current UTC time: {now}

User context:
- Name: {name}
- Role: {role_title}
- Department: {department}

Always be concise, professional, and direct. Address the user by first name. Never expose internal system names or "norman-" prefixes.

For any write operation (create, update, delete, send, approve), always show the user what you will do and wait for explicit confirmation before calling the underlying write tool. Read-only operations execute directly.

Email composition rules: keep AI-generated emails ≤ 150 words, no AI-isms."""


def _build_tools() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": "get_workstream_cards",
                "description": "Get workstream cards. Filter by project, status, or assignee.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "string"},
                        "status": {"type": "string"},
                        "limit": {"type": "integer", "default": 20},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_workstream_card",
                "description": "Create a new workstream card. Always preview before calling.",
                "parameters": {
                    "type": "object",
                    "required": ["title", "project_id"],
                    "properties": {
                        "title": {"type": "string"},
                        "project_id": {"type": "string"},
                        "description": {"type": "string"},
                        "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                        "assignee_user_id": {"type": "string"},
                        "due_date": {"type": "string", "format": "date"},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_projects",
                "description": "List all projects the user has access to.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_meetings",
                "description": "Get meetings. Optionally filter by date range.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "start_date": {"type": "string", "format": "date"},
                        "end_date": {"type": "string", "format": "date"},
                        "limit": {"type": "integer", "default": 10},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_knowledge",
                "description": "Semantic search across project files and wiki pages.",
                "parameters": {
                    "type": "object",
                    "required": ["query"],
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer", "default": 5},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "send_slack_message",
                "description": "Send a Slack DM or channel message. Always preview before calling.",
                "parameters": {
                    "type": "object",
                    "required": ["channel_or_user", "message"],
                    "properties": {
                        "channel_or_user": {"type": "string"},
                        "message": {"type": "string"},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_gmail",
                "description": "List or search Gmail emails for the current user.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "max_results": {"type": "integer", "default": 10},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_calendar_events",
                "description": "Get Google Calendar events for the user.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "start_date": {"type": "string"},
                        "end_date": {"type": "string"},
                        "max_results": {"type": "integer", "default": 10},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_candidates",
                "description": "Get recruitment candidates.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "job_role_id": {"type": "string"},
                        "status": {"type": "string"},
                        "limit": {"type": "integer", "default": 20},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_notifications",
                "description": "Get unread notifications for the current user.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "unread_only": {"type": "boolean", "default": True},
                        "limit": {"type": "integer", "default": 20},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "generate_nda",
                "description": "Generate a Non-Disclosure Agreement (NDA) Word document from the Kabuni template. Fills placeholders and uploads to Azure Blob. Always preview the details with the user before calling.",
                "parameters": {
                    "type": "object",
                    "required": ["receiving_party_name", "receiving_party_entity", "date_of_agreement", "registered_address", "purpose", "recipient_name", "recipient_email"],
                    "properties": {
                        "receiving_party_name": {"type": "string", "description": "Short name of the receiving party (individual or company)"},
                        "receiving_party_entity": {"type": "string", "description": "Full legal entity name"},
                        "date_of_agreement": {"type": "string", "description": "Date in YYYY-MM-DD format"},
                        "registered_address": {"type": "string", "description": "Registered address of the receiving party"},
                        "purpose": {"type": "string", "description": "Purpose of the NDA"},
                        "recipient_name": {"type": "string", "description": "Name of the external signer"},
                        "recipient_email": {"type": "string", "description": "Email of the external signer"},
                        "internal_signer_name": {"type": "string", "description": "Kabuni internal signer name (default: Palash Soundarkar)"},
                        "internal_signer_email": {"type": "string", "description": "Kabuni internal signer email (default: palash@kabuni.com)"},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_nda_submissions",
                "description": "List NDA submissions with their status.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "status": {"type": "string", "enum": ["generating", "generated", "sent", "signed", "failed"]},
                        "limit": {"type": "integer", "default": 20},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "send_nda_for_signature",
                "description": "Send a generated NDA for signature via DocuSign (internal signer first, then recipient). Admin only. Always confirm submission_id with user before calling.",
                "parameters": {
                    "type": "object",
                    "required": ["submission_id"],
                    "properties": {
                        "submission_id": {"type": "string"},
                        "dry_run": {"type": "boolean", "default": False},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_recruitment_analytics",
                "description": "Get recruitment analytics: candidate counts by status and job role.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "job_role_id": {"type": "string"},
                    },
                },
            },
        },
    ]


async def _execute_tool(tool_name: str, tool_args: dict, user: dict, conn: asyncpg.Connection) -> str:
    try:
        if tool_name == "get_workstream_cards":
            params = []
            query = """SELECT c.*, p.name as project_name, u.full_name as assignee_name
                       FROM cards c
                       LEFT JOIN projects p ON p.id = c.project_id
                       LEFT JOIN users u ON u.id = c.assignee_user_id
                       WHERE 1=1"""
            if tool_args.get("project_id"):
                params.append(tool_args["project_id"])
                query += f" AND c.project_id = ${len(params)}"
            if tool_args.get("status"):
                params.append(tool_args["status"])
                query += f" AND c.status::text = ${len(params)}"
            query += f" ORDER BY c.sort_order ASC, c.created_at DESC LIMIT {min(tool_args.get('limit', 20), 50)}"
            rows = await conn.fetch(query, *params)
            return json.dumps([dict(r) for r in rows], default=str)

        elif tool_name == "create_workstream_card":
            card_id = str(uuid.uuid4())
            await conn.execute(
                """INSERT INTO cards
                       (id, project_id, title, description, card_type, status, priority,
                        due_date, assignee_user_id, created_by_user_id, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, 'task', 'open', $5, $6, $7, $8, NOW(), NOW())""",
                card_id,
                tool_args.get("project_id"),
                tool_args.get("title"),
                tool_args.get("description"),
                tool_args.get("priority", "medium"),
                tool_args.get("due_date"),
                tool_args.get("assignee_user_id"),
                user["id"],
            )
            return json.dumps({"created": True, "card_id": card_id})

        elif tool_name == "get_projects":
            rows = await conn.fetch(
                """SELECT p.* FROM projects p
                   WHERE EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1)
                   OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = $1 AND ur.role::text IN ('admin','moderator'))
                   ORDER BY p.created_at DESC""",
                user["id"],
            )
            return json.dumps([dict(r) for r in rows], default=str)

        elif tool_name == "get_meetings":
            params = []
            query = "SELECT * FROM meetings WHERE 1=1"
            if tool_args.get("start_date"):
                params.append(tool_args["start_date"])
                query += f" AND date >= ${len(params)}"
            if tool_args.get("end_date"):
                params.append(tool_args["end_date"])
                query += f" AND date <= ${len(params)}"
            query += f" ORDER BY date DESC LIMIT {min(tool_args.get('limit', 10), 50)}"
            try:
                rows = await conn.fetch(query, *params)
                return json.dumps([dict(r) for r in rows], default=str)
            except Exception:
                return json.dumps([])

        elif tool_name == "search_knowledge":
            query_text = tool_args.get("query", "")
            limit = min(tool_args.get("limit", 5), 20)
            try:
                embedding = await embed_text(query_text)
                emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
                rows = await conn.fetch(
                    f"""SELECT fc.content, f.original_filename as filename,
                               1 - (fe.embedding <=> $1::vector) as similarity
                        FROM file_embeddings fe
                        JOIN file_chunks fc ON fc.id = fe.file_chunk_id
                        JOIN files f ON f.id = fc.file_id
                        ORDER BY fe.embedding <=> $1::vector
                        LIMIT {limit}""",
                    emb_str,
                )
                results = [
                    {"type": "file", "content": r["content"], "source": r["filename"],
                     "similarity": float(r["similarity"])}
                    for r in rows
                ]
            except Exception as e:
                logger.warning(f"Knowledge search failed: {e}")
                results = []
            return json.dumps(results, default=str)

        elif tool_name == "get_notifications":
            params = [user["id"]]
            query = "SELECT * FROM notifications WHERE user_id = $1"
            if tool_args.get("unread_only", True):
                query += " AND read = FALSE"
            query += f" ORDER BY created_at DESC LIMIT {min(tool_args.get('limit', 20), 50)}"
            try:
                rows = await conn.fetch(query, *params)
                return json.dumps([dict(r) for r in rows], default=str)
            except Exception:
                return json.dumps([])

        elif tool_name == "get_candidates":
            params = []
            query = "SELECT c.*, jr.title as job_title FROM candidates c LEFT JOIN job_roles jr ON jr.id = c.job_role_id WHERE 1=1"
            if tool_args.get("job_role_id"):
                params.append(tool_args["job_role_id"])
                query += f" AND c.job_role_id = ${len(params)}"
            if tool_args.get("status"):
                params.append(tool_args["status"])
                query += f" AND c.status = ${len(params)}"
            query += f" ORDER BY c.created_at DESC LIMIT {min(tool_args.get('limit', 20), 50)}"
            try:
                rows = await conn.fetch(query, *params)
                return json.dumps([dict(r) for r in rows], default=str)
            except Exception:
                return json.dumps([])

        elif tool_name == "generate_nda":
            try:
                from app.routers.nda import NDAGenerateRequest, generate_nda as _gen_nda
                req = NDAGenerateRequest(
                    submitter_email=user.get("email"),
                    receiving_party_name=tool_args["receiving_party_name"],
                    receiving_party_entity=tool_args["receiving_party_entity"],
                    date_of_agreement=tool_args["date_of_agreement"],
                    registered_address=tool_args["registered_address"],
                    purpose=tool_args["purpose"],
                    recipient_name=tool_args["recipient_name"],
                    recipient_email=tool_args["recipient_email"],
                    internal_signer_name=tool_args.get("internal_signer_name", "Palash Soundarkar"),
                    internal_signer_email=tool_args.get("internal_signer_email", "palash@kabuni.com"),
                )
                result = await _gen_nda(req, user, conn)
                return json.dumps(result, default=str)
            except Exception as e:
                return json.dumps({"error": str(e)})

        elif tool_name == "list_nda_submissions":
            params = []
            query = "SELECT id, receiving_party_name, recipient_email, status, created_at, docusign_envelope_id FROM nda_submissions WHERE 1=1"
            if tool_args.get("status"):
                params.append(tool_args["status"])
                query += f" AND status = ${len(params)}"
            query += f" ORDER BY created_at DESC LIMIT {min(tool_args.get('limit', 20), 50)}"
            try:
                rows = await conn.fetch(query, *params)
                return json.dumps([dict(r) for r in rows], default=str)
            except Exception:
                return json.dumps([])

        elif tool_name == "send_nda_for_signature":
            try:
                from app.routers.nda import NDASendSignatureRequest, send_nda_for_signature as _send_nda
                req = NDASendSignatureRequest(
                    submission_id=tool_args["submission_id"],
                    dry_run=tool_args.get("dry_run", False),
                )
                result = await _send_nda(req, user, conn)
                return json.dumps(result, default=str)
            except Exception as e:
                return json.dumps({"error": str(e)})

        elif tool_name == "get_recruitment_analytics":
            try:
                params = []
                base_q = "SELECT jr.title, jr.department, COUNT(c.id) as total, COUNT(c.id) FILTER (WHERE c.status = 'new') as new_count, COUNT(c.id) FILTER (WHERE c.status = 'reviewed') as reviewed_count, COUNT(c.id) FILTER (WHERE c.status = 'invited') as invited_count, COUNT(c.id) FILTER (WHERE c.status = 'rejected') as rejected_count FROM job_roles jr LEFT JOIN candidates c ON c.job_role_id = jr.id"
                if tool_args.get("job_role_id"):
                    params.append(tool_args["job_role_id"])
                    base_q += f" WHERE jr.id = ${len(params)}"
                base_q += " GROUP BY jr.id, jr.title, jr.department ORDER BY jr.created_at DESC"
                rows = await conn.fetch(base_q, *params)
                return json.dumps([dict(r) for r in rows], default=str)
            except Exception as e:
                return json.dumps({"error": str(e)})

        else:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})

    except Exception as e:
        logger.error(f"Tool {tool_name} error: {e}")
        return json.dumps({"error": str(e)})


async def _run_tool_loop(
    messages: list[dict],
    user: dict,
    conn: asyncpg.Connection,
) -> AsyncIterator[str]:
    tools = _build_tools()
    current_messages = list(messages)

    for round_num in range(MAX_TOOL_ROUNDS):
        opts = CallLLMOptions(
            workflow="norman-chat",
            messages=current_messages,
            tools=tools,
            tool_choice="auto",
        )

        if round_num == MAX_TOOL_ROUNDS - 1:
            async for line in stream_llm(opts):
                if line.startswith("data:"):
                    yield line + "\n\n"
            yield "data: [DONE]\n\n"
            return

        res = await call_llm_with_fallback(opts)
        msg = res["choices"][0]["message"]
        current_messages.append(msg)

        if not msg.get("tool_calls"):
            content = msg.get("content") or ""
            chunk = json.dumps({"choices": [{"delta": {"content": content}}]})
            yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"
            return

        for tc in msg["tool_calls"]:
            tool_name = tc["function"]["name"]
            try:
                tool_args = json.loads(tc["function"]["arguments"])
            except Exception:
                tool_args = {}

            meta = json.dumps({"choices": [{"delta": {"tool_use": {"name": tool_name}}}]})
            yield f"data: {meta}\n\n"

            result = await _execute_tool(tool_name, tool_args, user, conn)
            current_messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "name": tool_name,
                "content": result,
            })

    yield "data: [DONE]\n\n"


@router.post("/norman-chat")
async def norman_chat(
    body: NormanChatRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    system_prompt = _build_system_prompt(current_user)
    messages = [{"role": "system", "content": system_prompt}]
    for m in body.messages[-CONTEXT_MESSAGES:]:
        messages.append({"role": m.role, "content": m.content})

    async def generate():
        try:
            async for line in _run_tool_loop(messages, current_user, conn):
                yield line
        except Exception as e:
            error_chunk = json.dumps({"error": str(e), "choices": [{"delta": {"content": f"\n\nError: {str(e)}"}}]})
            yield f"data: {error_chunk}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/chat-with-project-context")
async def chat_with_project_context(
<<<<<<< HEAD
    body: ProjectChatRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
=======
    body: SimpleProjectChatRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    # Resolve project_id from chat
    chat_row = await conn.fetchrow("SELECT project_id FROM chats WHERE id = $1", body.chat_id)
    if not chat_row or not chat_row["project_id"]:
        raise HTTPException(status_code=404, detail="Chat not found")
    project_id = str(chat_row["project_id"])

>>>>>>> 811253bb (UI Layer Integration)
    project = await conn.fetchrow(
        """SELECT p.* FROM projects p
           WHERE p.id = $1 AND (
               EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = $1 AND pm.user_id = $2)
               OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = $2 AND ur.role::text IN ('admin','moderator'))
           )""",
<<<<<<< HEAD
        body.project_id, current_user["id"],
=======
        project_id, current_user["id"],
>>>>>>> 811253bb (UI Layer Integration)
    )
    if not project:
        raise HTTPException(status_code=403, detail="Project not found or access denied")

<<<<<<< HEAD
=======
    # Save user message to DB
    user_msg_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO chat_messages (id, chat_id, sender_type, sender_user_id, content, created_at)
           VALUES ($1, $2, 'user', $3, $4, NOW())""",
        user_msg_id, body.chat_id, current_user["id"], body.message,
    )
    await conn.execute(
        "UPDATE chats SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1", body.chat_id
    )

    # Load last N messages as context
    history_rows = await conn.fetch(
        """SELECT sender_type AS role, content FROM chat_messages
           WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2""",
        body.chat_id, CONTEXT_MESSAGES,
    )
    history = [{"role": r["role"], "content": r["content"]} for r in reversed(history_rows)]

>>>>>>> 811253bb (UI Layer Integration)
    # File manifest via project_sources → files
    files = await conn.fetch(
        """SELECT f.id, f.original_filename
           FROM files f
           JOIN project_sources ps ON ps.id = f.project_source_id
           WHERE ps.project_id = $1
           ORDER BY f.created_at DESC LIMIT 20""",
<<<<<<< HEAD
        body.project_id,
    )
    file_manifest = "\n".join([f"- {f['original_filename']} (id:{f['id']})" for f in files]) or "No files uploaded yet."

    # RAG: semantic search for the latest user message
    rag_context = ""
    user_messages = [m for m in body.messages if m.role == "user"]
    if user_messages:
        try:
            embedding = await embed_text(user_messages[-1].content)
            emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
            chunks = await conn.fetch(
                """SELECT fc.content, f.original_filename as filename,
                          1 - (fe.embedding <=> $1::vector) as similarity
                   FROM file_embeddings fe
                   JOIN file_chunks fc ON fc.id = fe.file_chunk_id
                   JOIN files f ON f.id = fc.file_id
                   JOIN project_sources ps ON ps.id = f.project_source_id
                   WHERE ps.project_id = $2
                   ORDER BY fe.embedding <=> $1::vector
                   LIMIT 5""",
                emb_str, body.project_id,
            )
            if chunks:
                rag_context = "\n\nRelevant file content:\n" + "\n---\n".join(
                    [f"[{c['filename']}]\n{c['content']}" for c in chunks]
                )
        except Exception as e:
            logger.warning(f"RAG search failed: {e}")
=======
        project_id,
    )
    file_manifest = "\n".join([f"- {f['original_filename']} (id:{f['id']})" for f in files]) or "No files uploaded yet."

    # RAG: semantic search on the user's message
    rag_context = ""
    try:
        embedding = await embed_text(body.message)
        emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
        chunks = await conn.fetch(
            """SELECT fc.content, f.original_filename AS filename
               FROM file_embeddings fe
               JOIN file_chunks fc ON fc.id = fe.file_chunk_id
               JOIN files f ON f.id = fc.file_id
               JOIN project_sources ps ON ps.id = f.project_source_id
               WHERE ps.project_id = $2
               ORDER BY fe.embedding <=> $1::vector
               LIMIT 5""",
            emb_str, project_id,
        )
        if chunks:
            rag_context = "\n\nRelevant file content:\n" + "\n---\n".join(
                [f"[{c['filename']}]\n{c['content']}" for c in chunks]
            )
    except Exception as e:
        logger.warning(f"RAG search failed: {e}")

    # Handle attachment text (inline context)
    attachment_context = ""
    for att in (body.attachments or []):
        if att.get("extractedText"):
            attachment_context += f"\n\n[Attached file: {att.get('name', 'file')}]\n{att['extractedText']}"
>>>>>>> 811253bb (UI Layer Integration)

    system_prompt = f"""{_build_system_prompt(current_user)}

You are working within project: {dict(project)['name']}
<<<<<<< HEAD
Project ID: {body.project_id}

Project files available:
{file_manifest}
{rag_context}"""

    messages = [{"role": "system", "content": system_prompt}]
    for m in body.messages[-CONTEXT_MESSAGES:]:
        messages.append({"role": m.role, "content": m.content})
=======
Project ID: {project_id}

Project files available:
{file_manifest}
{rag_context}{attachment_context}"""

    messages = [{"role": "system", "content": system_prompt}] + history

    # Collect and persist assistant reply
    assistant_chunks: list[str] = []
>>>>>>> 811253bb (UI Layer Integration)

    async def generate():
        try:
            async for line in _run_tool_loop(messages, current_user, conn):
<<<<<<< HEAD
=======
                if line.startswith("data: ") and not line.strip().endswith("[DONE]"):
                    try:
                        parsed = json.loads(line[6:])
                        chunk = parsed.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if chunk:
                            assistant_chunks.append(chunk)
                    except Exception:
                        pass
>>>>>>> 811253bb (UI Layer Integration)
                yield line
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"
<<<<<<< HEAD
=======
        finally:
            if assistant_chunks:
                reply = "".join(assistant_chunks)
                try:
                    await conn.execute(
                        """INSERT INTO chat_messages (id, chat_id, sender_type, content, created_at)
                           VALUES ($1, $2, 'assistant', $3, NOW())""",
                        str(uuid.uuid4()), body.chat_id, reply,
                    )
                    await conn.execute(
                        "UPDATE chats SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1",
                        body.chat_id,
                    )
                except Exception as e:
                    logger.warning(f"Failed to save assistant message: {e}")
>>>>>>> 811253bb (UI Layer Integration)

    return StreamingResponse(generate(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/generate-chat-title")
async def generate_chat_title(
    body: GenerateTitleRequest,
    current_user: dict = Depends(get_current_user),
):
    messages = [
        {"role": "system", "content": "Generate a short, descriptive title (max 6 words) for this conversation. Return only the title text, nothing else."},
    ] + [{"role": m.role, "content": m.content} for m in body.messages[:5]]
    opts = CallLLMOptions(workflow="generic", messages=messages, max_tokens=20, temperature=0.3)
    res = await call_llm_with_fallback(opts)
    title = (res["choices"][0]["message"].get("content") or "New Chat").strip().strip('"')
    return {"title": title}


# ── General chats (backed by chats + chat_messages) ───────────────────────────

@router.get("/general-chats")
async def get_general_chats(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    rows = await conn.fetch(
        """SELECT ch.*, COUNT(cm.id) as message_count
           FROM chats ch
           LEFT JOIN chat_messages cm ON cm.chat_id = ch.id
           WHERE ch.owner_user_id = $1 AND ch.project_id IS NULL
           GROUP BY ch.id
           ORDER BY ch.updated_at DESC LIMIT 50""",
        current_user["id"],
    )
    return [dict(r) for r in rows]


@router.post("/general-chats")
async def create_general_chat(
    body: dict,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    chat_id = str(uuid.uuid4())
    title = body.get("title", "New Chat")
    await conn.execute(
        """INSERT INTO chats (id, owner_user_id, title, chat_type, pinned, archived, created_at, updated_at)
           VALUES ($1, $2, $3, 'general', FALSE, FALSE, NOW(), NOW())""",
        chat_id, current_user["id"], title,
    )
    return {"id": chat_id, "title": title}


@router.get("/general-chats/{chat_id}/messages")
async def get_general_chat_messages(
    chat_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    # Verify ownership
    chat = await conn.fetchrow(
        "SELECT 1 FROM chats WHERE id = $1 AND owner_user_id = $2", chat_id, current_user["id"]
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    rows = await conn.fetch(
        "SELECT * FROM chat_messages WHERE chat_id = $1 ORDER BY created_at ASC", chat_id
    )
    return [dict(r) for r in rows]


@router.post("/general-chats/{chat_id}/messages")
async def save_general_chat_message(
    chat_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    msg_id = str(uuid.uuid4())
    role = body.get("role", "user")
    content = body.get("content", "")
    sender_type = "user" if role == "user" else "assistant"
    await conn.execute(
        """INSERT INTO chat_messages
               (id, chat_id, sender_type, sender_user_id, content, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())""",
        msg_id, chat_id, sender_type, current_user["id"], content,
    )
    # Update last_message_at on chat
    await conn.execute(
        "UPDATE chats SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1", chat_id
    )
    return {"id": msg_id}
