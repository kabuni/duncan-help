import os
from typing import Optional
from pydantic_settings import BaseSettings
from pydantic import AnyHttpUrl

VAULT_URL = "https://kv-duncan-dev-uks-01.vault.azure.net/"

_VAULT_SECRET_MAP = {
    "azure-pg-password": "AZURE_PG_PASSWORD",
    "supabase-jwt-secret": "SUPABASE_JWT_SECRET",
    "openai-api-key": "OPENAI_API_KEY",
    "azure-storage-connection-string": "AZURE_STORAGE_CONNECTION_STRING",
    "slack-bot-token": "SLACK_BOT_TOKEN",
    "slack-signing-secret": "SLACK_SIGNING_SECRET",
    "slack-client-id": "SLACK_CLIENT_ID",
    "slack-client-secret": "SLACK_CLIENT_SECRET",
    "gmail-client-id": "GMAIL_CLIENT_ID",
    "gmail-client-secret": "GMAIL_CLIENT_SECRET",
    "google-calendar-client-id": "GOOGLE_CALENDAR_CLIENT_ID",
    "google-calendar-client-secret": "GOOGLE_CALENDAR_CLIENT_SECRET",
    "google-analytics-client-id": "GOOGLE_ANALYTICS_CLIENT_ID",
    "google-analytics-client-secret": "GOOGLE_ANALYTICS_CLIENT_SECRET",
    "basecamp-client-id": "BASECAMP_CLIENT_ID",
    "basecamp-client-secret": "BASECAMP_CLIENT_SECRET",
    "azure-devops-client-id": "AZURE_DEVOPS_CLIENT_ID",
    "azure-devops-client-secret": "AZURE_DEVOPS_CLIENT_SECRET",
    "azure-devops-org-url": "AZURE_DEVOPS_ORG_URL",
    "xero-client-id": "XERO_CLIENT_ID",
    "xero-client-secret": "XERO_CLIENT_SECRET",
    "hireflix-api-key": "HIREFLIX_API_KEY",
    "docusign-integration-key": "DOCUSIGN_INTEGRATION_KEY",
    "docusign-user-id": "DOCUSIGN_USER_ID",
    "docusign-private-key": "DOCUSIGN_PRIVATE_KEY",
    "docusign-account-id": "DOCUSIGN_ACCOUNT_ID",
    "elevenlabs-api-key": "ELEVENLABS_API_KEY",
    "elevenlabs-agent-id": "ELEVENLABS_AGENT_ID",
}


def _ensure_az_on_path() -> None:
    common_paths = [
        r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin",
        r"C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin",
    ]
    current_path = os.environ.get("PATH", "")
    additions = [p for p in common_paths if p not in current_path]
    if additions:
        os.environ["PATH"] = current_path + ";" + ";".join(additions)


def _load_from_vault() -> dict:
    try:
        from azure.keyvault.secrets import SecretClient
        from azure.identity import AzureCliCredential
    except ImportError:
        print("azure-keyvault-secrets / azure-identity not installed — skipping vault load")
        return {}
    _ensure_az_on_path()
    try:
        client = SecretClient(vault_url=VAULT_URL, credential=AzureCliCredential())
        result = {}
        for secret_name, env_key in _VAULT_SECRET_MAP.items():
            try:
                value = client.get_secret(secret_name).value
                if value:
                    result[env_key] = value
            except Exception:
                pass
        print(f"Loaded {len(result)} secrets from Azure Key Vault")
        return result
    except Exception as e:
        print(f"Azure Key Vault unavailable, falling back to .env: {e}")
        return {}


class Settings(BaseSettings):
    # App
    APP_URL: str = "http://localhost:8080"
    ALLOWED_EMAIL_DOMAINS: str = "kabuni.com"
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Database (Azure PostgreSQL)
    AZURE_PG_HOST: str = "kabuni-dev-cin-postgresql-01.postgres.database.azure.com"
    AZURE_PG_PORT: int = 5432
    AZURE_PG_DATABASE: str = "postgres"
    AZURE_PG_USER: str = "duncan_db"
    AZURE_PG_PASSWORD: str = ""
    AZURE_PG_SSL: str = "require"

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.AZURE_PG_USER}:{self.AZURE_PG_PASSWORD}"
            f"@{self.AZURE_PG_HOST}:{self.AZURE_PG_PORT}/{self.AZURE_PG_DATABASE}"
        )

    @property
    def DATABASE_URL_SYNC(self) -> str:
        return (
            f"postgresql://{self.AZURE_PG_USER}:{self.AZURE_PG_PASSWORD}"
            f"@{self.AZURE_PG_HOST}:{self.AZURE_PG_PORT}/{self.AZURE_PG_DATABASE}"
        )

    # AI
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""

    # Azure Blob
    AZURE_BLOB_ACCOUNT: str = "stkabunidevstorage01"
    AZURE_BLOB_KEY: str = ""
    AZURE_BLOB_CONTAINER: str = "duncanstorage01"
    AZURE_STORAGE_CONNECTION_STRING: str = ""

    # Google OAuth
    GMAIL_CLIENT_ID: str = ""
    GMAIL_CLIENT_SECRET: str = ""
    GOOGLE_CALENDAR_CLIENT_ID: str = ""
    GOOGLE_CALENDAR_CLIENT_SECRET: str = ""
    GOOGLE_ANALYTICS_CLIENT_ID: str = ""
    GOOGLE_ANALYTICS_CLIENT_SECRET: str = ""

    # Integrations
    SLACK_BOT_TOKEN: str = ""
    SLACK_SIGNING_SECRET: str = ""
    SLACK_CLIENT_ID: str = ""
    SLACK_CLIENT_SECRET: str = ""
    BASECAMP_CLIENT_ID: str = ""
    BASECAMP_CLIENT_SECRET: str = ""
    AZURE_DEVOPS_CLIENT_ID: str = ""
    AZURE_DEVOPS_CLIENT_SECRET: str = ""
    AZURE_DEVOPS_ORG_URL: str = ""
    HIREFLIX_API_KEY: str = ""
    ELEVENLABS_API_KEY: str = ""
    ELEVENLABS_AGENT_ID: str = ""

    # DocuSign
    DOCUSIGN_INTEGRATION_KEY: str = ""
    DOCUSIGN_USER_ID: str = ""
    DOCUSIGN_PRIVATE_KEY: str = ""
    DOCUSIGN_ACCOUNT_ID: str = ""
    DOCUSIGN_BASE_PATH: str = "https://demo.docusign.net"

    # Notion
    NOTION_NDA_DB_ID: str = ""

    # HubSpot
    HUBSPOT_API_KEY: str = ""

    # Bootstrap — used once to promote the first admin; clear after use
    BOOTSTRAP_SECRET: str = ""

    # Redis (for Celery background jobs)
    REDIS_URL: str = "redis://localhost:6379/0"

    # CORS
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:8080",
        "http://localhost:8081",
        "http://localhost:8000",
        "https://duncan.help",
    ]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    def allowed_domains(self) -> list[str]:
        return [d.strip() for d in self.ALLOWED_EMAIL_DOMAINS.split(",") if d.strip()]


def _build_settings() -> Settings:
    # 1. Vault fills in anything not already in os.environ
    vault_secrets = _load_from_vault()
    for key, value in vault_secrets.items():
        os.environ.setdefault(key, value)
    # 2. .env values override vault — ONLY for vault-mapped keys whose .env
    #    entry is a real value (not a blank placeholder or inline comment like
    #    "# from vault: ...").  Skipping those lets the vault value stand.
    try:
        from dotenv import dotenv_values
        dot = dotenv_values()
        for env_key in _VAULT_SECRET_MAP.values():
            val = (dot.get(env_key) or "").strip()
            if val and not val.startswith("#"):
                os.environ[env_key] = val
    except Exception:
        pass
    return Settings()


settings = _build_settings()
