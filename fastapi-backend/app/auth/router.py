import secrets
import httpx
from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.responses import RedirectResponse

import asyncpg

from app.auth.models import (
    SignUpRequest, SignInRequest, TokenResponse, RefreshRequest,
    PasswordResetRequest, PasswordResetConfirm, ChangePasswordRequest, UserPublic,
)
from app.auth import service as auth_service
from app.auth.dependencies import get_current_user
from app.db_pool import get_connection
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def _build_user_public(user: dict, profile: dict | None, roles: list[str]) -> UserPublic:
    """Build UserPublic from users + auth_credentials JOIN result and user_profiles."""
    # user already contains auth_credentials fields via JOIN
    display_name = (
        (profile["nickname"] if profile else None)
        or user.get("full_name")
    )
    # role_title and department come from auth_credentials (in user dict)
    role_title = user.get("role_title")
    department = user.get("department")
    bio = profile["bio"] if profile else None

    return UserPublic(
        id=str(user["id"]),
        email=user["email"],
        display_name=display_name,
        role_title=role_title,
        department=department,
        bio=bio,
        norman_context=None,
        avatar_url=user.get("avatar_url"),
        status=auth_service.get_user_status(user),
        roles=roles,
        created_at=user.get("created_at"),
    )


async def _get_profile(conn: asyncpg.Connection, user_id) -> dict | None:
    row = await conn.fetchrow("SELECT * FROM user_profiles WHERE user_id = $1", user_id)
    return dict(row) if row else None


@router.post("/signup", response_model=dict, status_code=status.HTTP_201_CREATED)
async def signup(body: SignUpRequest, conn: asyncpg.Connection = Depends(get_connection)):
    email = body.email.strip().lower()
    if not auth_service.is_allowed_domain(email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only @{settings.ALLOWED_EMAIL_DOMAINS} email addresses are allowed",
        )

    existing = await auth_service.get_user_by_email(conn, email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    hashed = auth_service.hash_password(body.password)
    user = await auth_service.create_user(
        conn, email, hashed, body.display_name, body.role_title, body.department
    )

    return {
        "message": "Account created successfully. Please wait for admin approval before signing in.",
        "user_id": str(user["id"]),
        "status": "pending",
    }


@router.post("/signin", response_model=TokenResponse)
async def signin(body: SignInRequest, conn: asyncpg.Connection = Depends(get_connection)):
    email = body.email.strip().lower()
    user = await auth_service.get_user_by_email(conn, email)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    hashed = user.get("hashed_password")
    if not hashed or not auth_service.verify_password(body.password, hashed):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    user_status = auth_service.get_user_status(user)
    if user_status == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is pending admin approval",
        )
    if user_status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is not active")

    roles = await auth_service.get_user_roles(conn, str(user["id"]))
    access_token = auth_service.create_access_token(str(user["id"]), roles)
    refresh_token = auth_service.create_refresh_token(str(user["id"]))
    await auth_service.store_refresh_token(conn, str(user["id"]), refresh_token)

    profile = await _get_profile(conn, user["id"])

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=_build_user_public(user, profile, roles),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, conn: asyncpg.Connection = Depends(get_connection)):
    user_id = await auth_service.validate_refresh_token(conn, body.refresh_token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    user = await auth_service.get_user_by_id(conn, user_id)
    if not user or auth_service.get_user_status(user) != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    roles = await auth_service.get_user_roles(conn, user_id)
    access_token = auth_service.create_access_token(user_id, roles)
    new_refresh = auth_service.create_refresh_token(user_id)
    await auth_service.store_refresh_token(conn, user_id, new_refresh)

    profile = await _get_profile(conn, user["id"])

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=_build_user_public(user, profile, roles),
    )


@router.post("/signout", status_code=status.HTTP_204_NO_CONTENT)
async def signout(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    await auth_service.revoke_refresh_token(conn, current_user["id"])


@router.post("/password-reset/request", status_code=status.HTTP_200_OK)
async def request_password_reset(
    body: PasswordResetRequest,
    conn: asyncpg.Connection = Depends(get_connection),
):
    user = await auth_service.get_user_by_email(conn, body.email.strip().lower())
    if user:
        token = secrets.token_urlsafe(32)
        await auth_service.store_password_reset_token(conn, str(user["id"]), token)
        reset_link = f"{settings.APP_URL}/reset-password?token={token}"
        print(f"[password-reset] Link for {body.email}: {reset_link}")
    return {"message": "If that email exists, a reset link has been sent"}


@router.post("/password-reset/confirm", status_code=status.HTTP_200_OK)
async def confirm_password_reset(
    body: PasswordResetConfirm,
    conn: asyncpg.Connection = Depends(get_connection),
):
    user_id = await auth_service.validate_password_reset_token(conn, body.token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    hashed = auth_service.hash_password(body.new_password)
    await auth_service.update_password(conn, user_id, hashed)
    await auth_service.revoke_refresh_token(conn, user_id)
    return {"message": "Password updated successfully"}


@router.post("/change-password", status_code=status.HTTP_200_OK)
async def change_password(
    body: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    hashed = current_user.get("hashed_password")
    if not hashed or not auth_service.verify_password(body.current_password, hashed):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    new_hashed = auth_service.hash_password(body.new_password)
    await auth_service.update_password(conn, current_user["id"], new_hashed)
    await auth_service.revoke_refresh_token(conn, current_user["id"])
    return {"message": "Password changed successfully"}


@router.get("/me", response_model=UserPublic)
async def get_me(
    current_user: dict = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_connection),
):
    profile = await _get_profile(conn, current_user["id"])
    return _build_user_public(
        current_user,
        profile,
        current_user.get("roles", []),
    )


# ── Google OAuth ───────────────────────────────────────────────────────────────

@router.get("/google")
async def google_auth(current_user: dict = Depends(get_current_user)):
    state = f"{current_user['id']}:{secrets.token_urlsafe(16)}"
    params = {
        "client_id": settings.GMAIL_CLIENT_ID,
        "redirect_uri": f"{settings.APP_URL}/auth/google/callback",
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = GOOGLE_AUTH_URL + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    return {"url": url}


@router.get("/google/callback")
async def google_callback(
    code: str,
    state: str | None = None,
    conn: asyncpg.Connection = Depends(get_connection),
):
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.GMAIL_CLIENT_ID,
                "client_secret": settings.GMAIL_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": f"{settings.APP_URL}/auth/google/callback",
            },
        )
        if not token_resp.is_success:
            raise HTTPException(status_code=400, detail="Failed to exchange Google code")

        tokens = token_resp.json()
        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        userinfo = userinfo_resp.json()

    email = userinfo.get("email", "")
    if not auth_service.is_allowed_domain(email):
        return RedirectResponse(f"{settings.APP_URL}/auth?error=domain_not_allowed")

    user = await auth_service.get_user_by_email(conn, email)
    if not user:
        hashed = auth_service.hash_password(secrets.token_urlsafe(32))
        user = await auth_service.create_user(
            conn,
            email=email,
            hashed_password=hashed,
            display_name=userinfo.get("name", email.split("@")[0]),
        )
        return RedirectResponse(f"{settings.APP_URL}/auth?status=pending_approval")

    if auth_service.get_user_status(user) != "active":
        return RedirectResponse(f"{settings.APP_URL}/auth?error=account_pending")

    roles = await auth_service.get_user_roles(conn, str(user["id"]))
    access_token = auth_service.create_access_token(str(user["id"]), roles)
    refresh_token = auth_service.create_refresh_token(str(user["id"]))
    await auth_service.store_refresh_token(conn, str(user["id"]), refresh_token)

    return RedirectResponse(
        f"{settings.APP_URL}/auth/callback?access_token={access_token}&refresh_token={refresh_token}"
    )


# ── Bootstrap (first admin setup — disable BOOTSTRAP_SECRET after use) ────────

@router.post("/bootstrap-admin")
async def bootstrap_admin(
    body: dict,
    conn: asyncpg.Connection = Depends(get_connection),
):
    """
    One-time endpoint to approve a user and grant them admin role.
    Requires the BOOTSTRAP_SECRET set in .env.
    Clear BOOTSTRAP_SECRET after the first admin is set up.
    """
    secret = settings.BOOTSTRAP_SECRET
    if not secret:
        raise HTTPException(status_code=404, detail="Not found")

    if body.get("secret") != secret:
        raise HTTPException(status_code=403, detail="Invalid bootstrap secret")

    email = (body.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="email is required")

    user = await auth_service.get_user_by_email(conn, email)
    if not user:
        raise HTTPException(status_code=404, detail=f"No user found with email {email}")

    user_id = str(user["id"])
    await auth_service.approve_user(conn, user_id)

    # Grant admin role
    await conn.execute(
        """
        INSERT INTO user_roles (id, user_id, role)
        VALUES (gen_random_uuid(), $1, 'admin')
        ON CONFLICT DO NOTHING
        """,
        user_id,
    )

    return {"message": f"{email} is now an active admin. Remove BOOTSTRAP_SECRET from .env."}


# ── Admin endpoints ────────────────────────────────────────────────────────────

@router.get("/admin/pending-users")
async def list_pending_users(
    conn: asyncpg.Connection = Depends(get_connection),
    current_user: dict = Depends(get_current_user),
):
    if "admin" not in current_user.get("roles", []):
        raise HTTPException(status_code=403, detail="Admin only")
    rows = await conn.fetch(
        """SELECT u.id, u.email, u.full_name, u.created_at
           FROM users u
           JOIN auth_credentials ac ON ac.user_id = u.id
           WHERE ac.approval_status = 'pending'
           ORDER BY u.created_at DESC"""
    )
    return [dict(r) for r in rows]


@router.post("/admin/approve/{user_id}")
async def approve_user(
    user_id: str,
    conn: asyncpg.Connection = Depends(get_connection),
    current_user: dict = Depends(get_current_user),
):
    if "admin" not in current_user.get("roles", []):
        raise HTTPException(status_code=403, detail="Admin only")
    await auth_service.approve_user(conn, user_id)
    return {"message": "User approved"}


@router.post("/admin/reject/{user_id}")
async def reject_user(
    user_id: str,
    conn: asyncpg.Connection = Depends(get_connection),
    current_user: dict = Depends(get_current_user),
):
    if "admin" not in current_user.get("roles", []):
        raise HTTPException(status_code=403, detail="Admin only")
    await conn.execute(
        "UPDATE auth_credentials SET approval_status = 'rejected', updated_at = NOW() WHERE user_id = $1",
        user_id,
    )
    return {"message": "User rejected"}


@router.post("/admin/roles/{user_id}")
async def set_user_roles(
    user_id: str,
    body: dict,
    conn: asyncpg.Connection = Depends(get_connection),
    current_user: dict = Depends(get_current_user),
):
    if "admin" not in current_user.get("roles", []):
        raise HTTPException(status_code=403, detail="Admin only")

    roles = body.get("roles", [])
    valid_roles = {"admin", "moderator", "user"}
    if not all(r in valid_roles for r in roles):
        raise HTTPException(status_code=400, detail=f"Roles must be one of {valid_roles}")

    await conn.execute("DELETE FROM user_roles WHERE user_id = $1", user_id)
    for role in roles:
        await conn.execute(
            "INSERT INTO user_roles (id, user_id, role) VALUES (gen_random_uuid(), $1, $2::app_role) ON CONFLICT DO NOTHING",
            user_id, role,
        )
    return {"message": "Roles updated", "roles": roles}
