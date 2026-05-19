"""
Workstream cards, steps, comments, and activity routes.
Real tables: cards, card_steps, card_comments, card_activity
"""
import uuid
import logging
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_user
from app.db_pool import get_connection

logger = logging.getLogger(__name__)
router = APIRouter(tags=["workstreams"])


class CreateCardRequest(BaseModel):
    project_id: str
    title: str
    description: Optional[str] = None
    card_type: str = "task"
    status: str = "open"
    priority: str = "medium"
    due_date: Optional[str] = None
    assignee_user_id: Optional[str] = None


class UpdateCardRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None
    assignee_user_id: Optional[str] = None


class CreateStepRequest(BaseModel):
    card_id: str
    title: str
    description: Optional[str] = None
    status: str = "open"
    due_date: Optional[str] = None
    assignee_user_id: Optional[str] = None


class CreateCommentRequest(BaseModel):
    comment_text: str


@router.get("/workstream-cards")
async def get_workstream_cards(
    project_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    params = []
    query = """
        SELECT c.*,
               p.name as project_name,
               u.full_name as assignee_name,
               COUNT(DISTINCT cs.id) as step_count
        FROM cards c
        LEFT JOIN projects p ON p.id = c.project_id
        LEFT JOIN users u ON u.id = c.assignee_user_id
        LEFT JOIN card_steps cs ON cs.card_id = c.id
        WHERE 1=1
    """
    if project_id:
        params.append(project_id)
        query += f" AND c.project_id = ${len(params)}"
    if status:
        params.append(status)
        query += f" AND c.status::text = ${len(params)}"
    query += " GROUP BY c.id, p.name, u.full_name ORDER BY c.sort_order ASC, c.created_at DESC"
    rows = await conn.fetch(query, *params)
    return [dict(r) for r in rows]


@router.post("/workstream-cards", status_code=201)
async def create_workstream_card(
    body: CreateCardRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    card_id = str(uuid.uuid4())
    async with conn.transaction():
        await conn.execute(
            """INSERT INTO cards
                   (id, project_id, title, description, card_type, status, priority,
                    due_date, assignee_user_id, created_by_user_id, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7,
                       $8, $9, $10, NOW(), NOW())""",
            card_id, body.project_id, body.title, body.description,
            body.card_type, body.status, body.priority,
            body.due_date, body.assignee_user_id, current_user["id"],
        )
        await conn.execute(
            """INSERT INTO card_activity
                   (id, card_id, actor_user_id, activity_type, payload, created_at)
               VALUES ($1, $2, $3, 'created', $4::jsonb, NOW())""",
            str(uuid.uuid4()), card_id, current_user["id"],
            f'{{"title": "{body.title}"}}',
        )
    row = await conn.fetchrow("SELECT * FROM cards WHERE id = $1", card_id)
    return dict(row)


@router.put("/workstream-cards/{card_id}")
async def update_workstream_card(
    card_id: str,
    body: UpdateCardRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    row = await conn.fetchrow("SELECT * FROM cards WHERE id = $1", card_id)
    if not row:
        raise HTTPException(status_code=404, detail="Card not found")

    updates: dict = {}
    if body.title is not None:
        updates["title"] = body.title
    if body.description is not None:
        updates["description"] = body.description
    if body.status is not None:
        updates["status"] = body.status
    if body.priority is not None:
        updates["priority"] = body.priority
    if body.due_date is not None:
        updates["due_date"] = body.due_date
    if body.assignee_user_id is not None:
        updates["assignee_user_id"] = body.assignee_user_id

    if updates:
        set_parts = []
        params = [card_id]
        for key, val in updates.items():
            params.append(val)
            set_parts.append(f"{key} = ${len(params)}")
        set_clause = ", ".join(set_parts)
        await conn.execute(
            f"UPDATE cards SET {set_clause}, updated_at = NOW() WHERE id = $1",
            *params,
        )

    updated = await conn.fetchrow("SELECT * FROM cards WHERE id = $1", card_id)
    return dict(updated)


@router.delete("/workstream-cards/{card_id}")
async def delete_workstream_card(
    card_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    row = await conn.fetchrow("SELECT id FROM cards WHERE id = $1", card_id)
    if not row:
        raise HTTPException(status_code=404, detail="Card not found")
    await conn.execute("DELETE FROM cards WHERE id = $1", card_id)
    return {"deleted": True}


# ── Card steps (sub-tasks) ─────────────────────────────────────────────────────

@router.get("/workstream-cards/{card_id}/tasks")
async def get_card_steps(
    card_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    rows = await conn.fetch(
        """SELECT cs.*, u.full_name as assignee_name
           FROM card_steps cs
           LEFT JOIN users u ON u.id = cs.assignee_user_id
           WHERE cs.card_id = $1
           ORDER BY cs.sort_order ASC, cs.created_at ASC""",
        card_id,
    )
    return [dict(r) for r in rows]


@router.post("/workstream-tasks", status_code=201)
async def create_card_step(
    body: CreateStepRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    step_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO card_steps
               (id, card_id, title, description, status, due_date, assignee_user_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())""",
        step_id, body.card_id, body.title, body.description,
        body.status, body.due_date, body.assignee_user_id,
    )
    row = await conn.fetchrow("SELECT * FROM card_steps WHERE id = $1", step_id)
    return dict(row)


@router.put("/workstream-tasks/{step_id}")
async def update_card_step(
    step_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    allowed = {"title", "description", "status", "due_date", "assignee_user_id"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    set_parts = []
    params = [step_id]
    for key, val in updates.items():
        params.append(val)
        set_parts.append(f"{key} = ${len(params)}")
    set_clause = ", ".join(set_parts)
    await conn.execute(
        f"UPDATE card_steps SET {set_clause}, updated_at = NOW() WHERE id = $1",
        *params,
    )
    row = await conn.fetchrow("SELECT * FROM card_steps WHERE id = $1", step_id)
    return dict(row)


# ── Card comments ──────────────────────────────────────────────────────────────

@router.get("/workstream-cards/{card_id}/comments")
async def get_card_comments(
    card_id: str,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    rows = await conn.fetch(
        """SELECT cc.*, u.full_name as author_name, u.avatar_url
           FROM card_comments cc
           LEFT JOIN users u ON u.id = cc.author_user_id
           WHERE cc.card_id = $1
           ORDER BY cc.created_at ASC""",
        card_id,
    )
    return [dict(r) for r in rows]


@router.post("/workstream-cards/{card_id}/comments", status_code=201)
async def create_card_comment(
    card_id: str,
    body: CreateCommentRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    comment_id = str(uuid.uuid4())
    await conn.execute(
        """INSERT INTO card_comments (id, card_id, author_user_id, comment_text, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())""",
        comment_id, card_id, current_user["id"], body.comment_text,
    )
    row = await conn.fetchrow("SELECT * FROM card_comments WHERE id = $1", comment_id)
    return dict(row)


# ── Overdue check ──────────────────────────────────────────────────────────────

@router.get("/check-overdue-tasks")
async def check_overdue_tasks(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    overdue = await conn.fetch(
        """SELECT c.id, c.title, c.status::text, c.due_date, p.name as project_name
           FROM cards c
           LEFT JOIN projects p ON p.id = c.project_id
           WHERE c.due_date < NOW()::date
             AND c.status::text NOT IN ('done', 'cancelled')
           ORDER BY c.due_date ASC
           LIMIT 50"""
    )
    return {"overdue_count": len(overdue), "cards": [dict(r) for r in overdue]}
