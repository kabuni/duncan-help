"""DocuSign JWT auth and envelope creation (RS256, 2-signer routing)."""
import time
import logging

import httpx
from jose import jwt

from app.config import settings

logger = logging.getLogger(__name__)


def _auth_server() -> str:
    return "account-d.docusign.com" if "demo" in settings.DOCUSIGN_BASE_PATH else "account.docusign.com"


async def get_access_token() -> str:
    integration_key = settings.DOCUSIGN_INTEGRATION_KEY
    user_id = settings.DOCUSIGN_USER_ID
    raw_key = settings.DOCUSIGN_PRIVATE_KEY

    if not all([integration_key, user_id, raw_key]):
        raise ValueError("DocuSign credentials not configured (DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_PRIVATE_KEY)")

    # Normalise escaped newlines stored as literal \n in the vault
    private_key = raw_key.replace("\\n", "\n")
    auth_server = _auth_server()

    now = int(time.time())
    claims = {
        "iss": integration_key,
        "sub": user_id,
        "aud": auth_server,
        "iat": now,
        "exp": now + 3600,
        "scope": "signature impersonation",
    }

    token = jwt.encode(claims, private_key, algorithm="RS256")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://{auth_server}/oauth/token",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": token},
        )

    if not resp.is_success:
        raise ValueError(f"DocuSign token exchange failed: {resp.text[:300]}")

    return resp.json()["access_token"]


async def create_envelope(submission: dict, doc_base64: str, doc_filename: str) -> str:
    """Create a DocuSign envelope with internal-first 2-signer routing. Returns envelope_id."""
    access_token = await get_access_token()
    account_id = settings.DOCUSIGN_ACCOUNT_ID
    base_path = settings.DOCUSIGN_BASE_PATH

    if not account_id:
        raise ValueError("DOCUSIGN_ACCOUNT_ID not configured")

    internal_email = submission.get("internal_signer_email") or "palash@kabuni.com"
    internal_name = submission.get("internal_signer_name") or "Palash Soundarkar"

    envelope_body = {
        "emailSubject": f"NDA - {submission['receiving_party_name']} — Please sign",
        "documents": [
            {
                "documentBase64": doc_base64,
                "name": doc_filename,
                "fileExtension": "docx",
                "documentId": "1",
            }
        ],
        "recipients": {
            "signers": [
                {
                    "email": internal_email,
                    "name": internal_name,
                    "recipientId": "1",
                    "routingOrder": "1",
                    "tabs": {
                        "signHereTabs": [{"documentId": "1", "anchorString": "/sig1/", "anchorUnits": "pixels"}],
                        "fullNameTabs": [{"documentId": "1", "anchorString": "/name1/", "anchorUnits": "pixels"}],
                        "titleTabs": [{"documentId": "1", "anchorString": "/title1/", "anchorUnits": "pixels"}],
                        "dateSignedTabs": [{"documentId": "1", "anchorString": "/date1/", "anchorUnits": "pixels"}],
                    },
                },
                {
                    "email": submission["recipient_email"],
                    "name": submission["recipient_name"],
                    "recipientId": "2",
                    "routingOrder": "2",
                    "tabs": {
                        "signHereTabs": [{"documentId": "1", "anchorString": "/sig2/", "anchorUnits": "pixels"}],
                        "fullNameTabs": [{"documentId": "1", "anchorString": "/name2/", "anchorUnits": "pixels"}],
                        "titleTabs": [{"documentId": "1", "anchorString": "/title2/", "anchorUnits": "pixels"}],
                        "dateSignedTabs": [{"documentId": "1", "anchorString": "/date2/", "anchorUnits": "pixels"}],
                    },
                },
            ]
        },
        "status": "sent",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{base_path}/restapi/v2.1/accounts/{account_id}/envelopes",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=envelope_body,
        )

    if not resp.is_success:
        raise ValueError(f"DocuSign envelope creation failed: {resp.text[:300]}")

    return resp.json()["envelopeId"]
