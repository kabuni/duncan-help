"""
Duncan FastAPI Backend
Central operational intelligence system for Kabuni.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.db_pool import init_pool, close_pool

# Routers
from app.auth.router import router as auth_router
from app.routers.chat import router as chat_router
from app.routers.projects import router as projects_router
from app.routers.workstreams import router as workstreams_router
from app.routers.recruitment import router as recruitment_router
from app.routers.meetings import router as meetings_router
from app.routers.storage import router as storage_router
from app.routers.admin import router as admin_router
from app.routers.integrations.gmail import router as gmail_router
from app.routers.integrations.google_calendar import router as gcal_router
from app.routers.integrations.google_drive import router as gdrive_router
from app.routers.integrations.basecamp import router as basecamp_router
from app.routers.integrations.azure_devops import router as devops_router
from app.routers.integrations.slack import router as slack_router
from app.routers.integrations.elevenlabs import router as elevenlabs_router
from app.routers.integrations.hubspot import router as hubspot_router
<<<<<<< HEAD
from app.routers.nda import router as nda_router
=======
from app.routers.integrations.xero import router as xero_router
from app.routers.integrations.google_analytics import router as ganalytics_router
from app.routers.integrations.github import router as github_router
from app.routers.nda import router as nda_router
from app.routers.events import router as events_router
from app.routers.purchase_orders import router as po_router
from app.routers.forms import router as forms_router
>>>>>>> 811253bb (UI Layer Integration)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Duncan backend starting up...")
    await init_pool()
    logger.info("Database pool initialized")
    yield
    logger.info("Duncan backend shutting down...")
    await close_pool()


app = FastAPI(
    title="Duncan API",
    description="Kabuni's central operational intelligence platform",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

<<<<<<< HEAD
# CORS — preserve headers the existing React frontend sends
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS + ["*"],
=======
# CORS
# allow_credentials=True is incompatible with allow_origins=["*"].
# Use the explicit origins list only; add any new dev origins to CORS_ORIGINS in .env.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
>>>>>>> 811253bb (UI Layer Integration)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=[
        "authorization",
        "content-type",
        "x-client-info",
        "apikey",
<<<<<<< HEAD
=======
        "ngrok-skip-browser-warning",
>>>>>>> 811253bb (UI Layer Integration)
        "x-supabase-client-platform",
        "x-supabase-client-platform-version",
        "x-supabase-client-runtime",
        "x-supabase-client-runtime-version",
    ],
)


# Global error handler — never swallow 429/402/5xx
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    status = getattr(exc, "status_code", None) or getattr(exc, "status", 500)
    if status < 400:
        status = 500
    return JSONResponse(
        status_code=status,
        content={"error": str(exc), "code": getattr(exc, "code", None)},
    )


# Health check
@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok", "service": "duncan-api"}


# Register all routers
# Auth — own implementation replacing Supabase Auth
app.include_router(auth_router)

# Chat / AI core
app.include_router(chat_router)

# Projects
app.include_router(projects_router)

# Workstreams
app.include_router(workstreams_router)

# Recruitment
app.include_router(recruitment_router)

# Meetings & briefings
app.include_router(meetings_router)

# Azure Blob Storage proxy
app.include_router(storage_router)

# Admin & misc
app.include_router(admin_router)

# Integrations
app.include_router(gmail_router)
app.include_router(gcal_router)
app.include_router(gdrive_router)
app.include_router(basecamp_router)
app.include_router(devops_router)
app.include_router(slack_router)
app.include_router(elevenlabs_router)
app.include_router(hubspot_router)
<<<<<<< HEAD

# NDA agentic flow
app.include_router(nda_router)
=======
app.include_router(xero_router)
app.include_router(ganalytics_router)
app.include_router(github_router)

# NDA agentic flow
app.include_router(nda_router)

# Business logic
app.include_router(events_router)
app.include_router(po_router)
app.include_router(forms_router)
>>>>>>> 811253bb (UI Layer Integration)
