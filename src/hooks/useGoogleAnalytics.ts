import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const ANALYTICS_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-analytics-api`;
const ANALYTICS_AUTH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-analytics-auth`;

export interface AnalyticsDashboard {
  connected: boolean;
  propertyId?: string;
  summary: {
    activeUsers: number;
    sessions: number;
    pageViews: number;
    engagementRate: number;
  };
  topPages: Array<{ page: string; views: number; users: number }>;
  reach: {
    countries: Array<{ label: string; value: number; users: number; sessions: number }>;
    cities: Array<{ label: string; value: number; users: number; sessions: number }>;
  };
  devices: Array<{ label: string; value: number; users: number; sessions: number }>;
  demographics: {
    available: boolean;
    reason?: string;
    rows: Array<{ age: string; gender: string; users: number }>;
  };
  sources: Array<{ label: string; value: number; users: number; sessions: number }>;
  generatedAt: string;
}

export function useGoogleAnalytics() {
  const { session } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAsking, setIsAsking] = useState(false);

  const getAuthHeaders = useCallback(() => {
    if (!session?.access_token) throw new Error("Not authenticated");
    return {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    };
  }, [session]);

  const dashboardQuery = useQuery({
    queryKey: ["google-analytics-dashboard", session?.user?.id],
    enabled: !!session,
    retry: false,
    queryFn: async () => {
      const response = await fetch(ANALYTICS_API_URL, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ action: "dashboard" }),
      });

      const data = await response.json().catch(() => ({}));
      if (data.code === "NOT_CONNECTED" || data.connected === false) return null;
      if (!response.ok) throw new Error(data.error || "Failed to load Google Analytics");
      return data as AnalyticsDashboard;
    },
  });

  const initiateOAuth = useCallback(async () => {
    setIsConnecting(true);
    try {
      const response = await fetch(ANALYTICS_AUTH_URL, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || "Failed to connect Google Analytics");
      window.location.href = data.url;
    } finally {
      setIsConnecting(false);
    }
  }, [getAuthHeaders]);

  const askQuestion = useCallback(async (question: string) => {
    setIsAsking(true);
    try {
      const response = await fetch(ANALYTICS_API_URL, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ action: "askQuestion", question }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Duncan could not answer that analytics question");
      return data.answer as string;
    } finally {
      setIsAsking(false);
    }
  }, [getAuthHeaders]);

  const disconnect = useCallback(async () => {
    const response = await fetch(ANALYTICS_API_URL, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ action: "disconnect" }),
    });
    if (!response.ok) throw new Error("Failed to disconnect Google Analytics");
    await dashboardQuery.refetch();
  }, [dashboardQuery, getAuthHeaders]);

  return {
    dashboard: dashboardQuery.data ?? null,
    isConnected: !!dashboardQuery.data,
    isLoading: dashboardQuery.isLoading,
    error: dashboardQuery.error,
    refetch: dashboardQuery.refetch,
    initiateOAuth,
    isConnecting,
    askQuestion,
    isAsking,
    disconnect,
  };
}
