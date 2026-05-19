import uuid
import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import asyncpg
from jose import jwt, JWTError

from app.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, roles: list[str]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "roles": roles, "exp": expire, "type": "access"},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def create_refresh_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "refresh"},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


def is_allowed_domain(email: str) -> bool:
    domain = email.split("@")[-1].lower()
    return domain in settings.allowed_domains()


def get_user_status(user: dict) -> str:
    """Normalise approval_status + is_active into a single status string."""
    approval = user.get("approval_status") or "active"
    if approval == "pending":
        return "pending"
    if approval == "suspended" or not user.get("is_active", True):
        return "suspended"
    return "active"


async def get_user_roles(conn: asyncpg.Connection, user_id: str) -> list[str]:
    rows = await conn.fetch("SELECT role FROM user_roles WHERE user_id = $1", user_id)
    return [str(r["role"]) for r in rows]


# ── User queries (JOIN users + auth_credentials) ──────────────────────────────

_USER_SELECT = """
    SELECT u.id, u.email, u.full_name, u.avatar_url, u.auth_provider,
           u.is_active, u.last_login_at, u.created_at, u.updated_at,
           ac.hashed_password, ac.approval_status, ac.role_title, ac.department
    FROM users u
    LEFT JOIN auth_credentials ac ON ac.user_id = u.id
"""


async def get_user_by_email(conn: asyncpg.Connection, email: str) -> Optional[dict]:
    row = await conn.fetchrow(_USER_SELECT + " WHERE u.email = $1", email)
    return dict(row) if row else None


async def get_user_by_id(conn: asyncpg.Connection, user_id: str) -> Optional[dict]:
    row = await conn.fetchrow(_USER_SELECT + " WHERE u.id = $1", user_id)
    return dict(row) if row else None


async def create_user(
    conn: asyncpg.Connection,
    email: str,
    hashed_password: str,
    display_name: str,
    role_title: Optional[str] = None,
    department: Optional[str] = None,
) -> dict:
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    async with conn.transaction():
        # Insert into the existing users table (only columns that exist)
        await conn.execute(
            """
            INSERT INTO users (id, email, full_name, auth_provider, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, 'local', FALSE, $4, $4)
            """,
            user_id, email, display_name, now,
        )
        # Store credentials in auth_credentials
        await conn.execute(
            """
            INSERT INTO auth_credentials
                (user_id, hashed_password, approval_status, role_title, department, created_at, updated_at)
            VALUES ($1, $2, 'pending', $3, $4, $5, $5)
            """,
            user_id, hashed_password, role_title, department, now,
        )
        # Create profile stub
        await conn.execute(
            """
            INSERT INTO user_profiles (user_id, nickname, created_at, updated_at)
            VALUES ($1, $2, $3, $3)
            ON CONFLICT (user_id) DO NOTHING
            """,
            user_id, display_name, now,
        )

    row = await conn.fetchrow(_USER_SELECT + " WHERE u.id = $1", user_id)
    return dict(row)


async def approve_user(conn: asyncpg.Connection, user_id: str) -> None:
    async with conn.transaction():
        await conn.execute(
            "UPDATE auth_credentials SET approval_status = 'active', updated_at = NOW() WHERE user_id = $1",
            user_id,
        )
        await conn.execute(
            "UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE id = $1",
            user_id,
        )


async def update_password(conn: asyncpg.Connection, user_id: str, hashed_password: str) -> None:
    await conn.execute(
        "UPDATE auth_credentials SET hashed_password = $1, updated_at = NOW() WHERE user_id = $2",
        hashed_password, user_id,
    )


# ── Token storage ──────────────────────────────────────────────────────────────

async def store_refresh_token(conn: asyncpg.Connection, user_id: str, token: str) -> None:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    await conn.execute(
        """
        INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id) DO UPDATE
            SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at
        """,
        str(uuid.uuid4()), user_id, token_hash, expire,
    )


async def validate_refresh_token(conn: asyncpg.Connection, token: str) -> Optional[str]:
    try:
        payload = decode_token(token)
        if payload.get("type") != "refresh":
            return None
        user_id = payload.get("sub")
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        row = await conn.fetchrow(
            "SELECT user_id FROM refresh_tokens WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()",
            user_id, token_hash,
        )
        return user_id if row else None
    except JWTError:
        return None


async def revoke_refresh_token(conn: asyncpg.Connection, user_id: str) -> None:
    await conn.execute("DELETE FROM refresh_tokens WHERE user_id = $1", user_id)


async def store_password_reset_token(conn: asyncpg.Connection, user_id: str, token: str) -> None:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expire = datetime.now(timezone.utc) + timedelta(hours=1)
    await conn.execute(
        """
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id) DO UPDATE
            SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at
        """,
        str(uuid.uuid4()), user_id, token_hash, expire,
    )


async def validate_password_reset_token(conn: asyncpg.Connection, token: str) -> Optional[str]:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    row = await conn.fetchrow(
        "SELECT user_id FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > NOW()",
        token_hash,
    )
    if row:
        await conn.execute(
            "DELETE FROM password_reset_tokens WHERE token_hash = $1", token_hash
        )
        return str(row["user_id"])
    return None
