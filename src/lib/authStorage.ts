const STORAGE_KEY = "duncan_auth";

export interface DuncanUser {
  id: string;
  email: string;
  display_name?: string | null;
  role_title?: string | null;
  department?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  roles?: string[];
  status?: string;
}

export interface DuncanSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user: DuncanUser;
}

export function getAuthSession(): DuncanSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DuncanSession) : null;
  } catch {
    return null;
  }
}

export function setAuthSession(session: DuncanSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearAuthSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getAuthToken(): string | null {
  return getAuthSession()?.access_token ?? null;
}

export function getAuthUser(): DuncanUser | null {
  return getAuthSession()?.user ?? null;
}

export function notifyAuthChange(loggedIn: boolean): void {
  window.dispatchEvent(new CustomEvent("duncan-auth-change", { detail: { loggedIn } }));
}
