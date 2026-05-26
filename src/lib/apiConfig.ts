// External FastAPI shadow backend is disabled.
// Previously read VITE_API_BASE_URL (an ngrok tunnel); removed for security
// so no auth tokens or app traffic leave Supabase.
export const API_BASE_URL = "";

export const API_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

export function apiHeaders(accessToken?: string | null): Record<string, string> {
  return {
    ...API_HEADERS,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

export const hasExternalApiBase = false;
