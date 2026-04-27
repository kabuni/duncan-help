import { apiClient } from "@/lib/apiClient";

/**
 * SSE streaming chat endpoint.
 * Returns a raw Response so the caller can consume the ReadableStream.
 */
export const streamChat = async (body: {
  messages: Array<{ role: string; content: unknown }>;
  mode?: string;
  userProfile?: Record<string, unknown>;
}): Promise<Response> => {
  return apiClient.stream("/norman-chat", body);
};
