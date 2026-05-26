import { useState, useCallback } from "react";
import { getAuthToken } from "@/lib/authStorage";
import { fastApi } from "@/lib/fastApiClient";

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

  const listFiles = useCallback(async (path: string = ""): Promise<{ files: BlobFile[]; folders: string[] }> => {
    setIsLoading(true);
    try {
      return await fastApi("POST", "/azure-blob-api", { action: "list", path });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const searchFiles = useCallback(async (query: string): Promise<{ found: number; files: BlobFile[] }> => {
    setIsLoading(true);
    try {
      return await fastApi("POST", "/azure-blob-api", { action: "search", query });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const uploadFile = useCallback(async (file: File, path: string): Promise<{ url: string; blob_path: string }> => {
    setIsLoading(true);
    try {
      const token = getAuthToken();
      if (!token) throw new Error("Not authenticated");

      const apiBase = import.meta.env.VITE_API_BASE_URL;
      if (!apiBase) throw new Error("VITE_API_BASE_URL not configured");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("path", path);

      const response = await fetch(`${apiBase}/azure-blob-api/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "ngrok-skip-browser-warning": "1",
        },
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any).error || "Upload failed");
      }

      return await response.json();
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getFileContent = useCallback(async (blobPath: string): Promise<BlobContent> => {
    setIsLoading(true);
    try {
      return await fastApi("POST", "/azure-blob-api", { action: "get_content", blob_path: blobPath });
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isLoading,
    listFiles,
    searchFiles,
    uploadFile,
    getFileContent,
  };
}
