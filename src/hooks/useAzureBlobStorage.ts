import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BlobFile {
  name: string;
  url: string;
  size: number;
  lastModified: string;
}

export interface BlobContent {
  name: string;
  blob_path: string;
  content: string;
  url: string;
}

export function useAzureBlobStorage() {
  const [isLoading, setIsLoading] = useState(false);

  const getAuthHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return { Authorization: `Bearer ${session.access_token}` };
  }, []);

  const listFiles = useCallback(async (path: string = ""): Promise<{ files: BlobFile[]; folders: string[] }> => {
    setIsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const { data, error } = await supabase.functions.invoke("azure-blob-api", {
        headers,
        body: { action: "list", path },
      });
      if (error) throw new Error(error.message || "Failed to list files");
      return data;
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders]);

  const searchFiles = useCallback(async (query: string): Promise<{ found: number; files: BlobFile[] }> => {
    setIsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const { data, error } = await supabase.functions.invoke("azure-blob-api", {
        headers,
        body: { action: "search", query },
      });
      if (error) throw new Error(error.message || "Failed to search files");
      return data;
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders]);

  const uploadFile = useCallback(async (file: File, path: string): Promise<{ url: string; blob_path: string }> => {
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("path", path);

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/azure-blob-api`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Upload failed");
      }

      return await response.json();
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getFileContent = useCallback(async (blobPath: string): Promise<BlobContent> => {
    setIsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const { data, error } = await supabase.functions.invoke("azure-blob-api", {
        headers,
        body: { action: "get_content", blob_path: blobPath },
      });
      if (error) throw new Error(error.message || "Failed to get file content");
      return data;
    } finally {
      setIsLoading(false);
    }
  }, [getAuthHeaders]);

  return {
    isLoading,
    listFiles,
    searchFiles,
    uploadFile,
    getFileContent,
  };
}
