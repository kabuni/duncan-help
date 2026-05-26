import { useState, useEffect, useCallback } from "react";
import { fastApi } from "@/lib/fastApiClient";
import { getAuthToken, getAuthUser } from "@/lib/authStorage";
import { useToast } from "@/hooks/use-toast";

const currentUserDisplayName = (): string => {
  const user = getAuthUser();
  return (user as any)?.display_name || user?.email || "You";
};

export interface Project {
  id: string;
  user_id: string;          // alias for owner_user_id
  owner_user_id: string;
  name: string;
  slug?: string;
  description?: string | null;
  system_prompt?: string | null; // alias for description
  note_template?: string | null;
  status?: string;
  member_count?: number;
  card_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface ProjectChat {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at?: string;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  user_id: string | null;
  sender_name?: string | null;
  sender_avatar_url?: string | null;
}

export interface ProjectFile {
  id: string;
  project_id: string;
  file_name: string;
  storage_path: string;
  size?: number;
  mime_type?: string;
  extracted_text?: string | null;
  created_at: string;
}

export interface ProjectMember {
  user_id: string;
  display_name: string | null;
  role_title: string | null;
  avatar_url: string | null;
  role?: string;
  isOwner: boolean;
}

function _mapProject(raw: any): Project {
  return {
    ...raw,
    owner_user_id: raw.owner_user_id,
    user_id: raw.owner_user_id,        // backward-compat alias
    system_prompt: raw.description,    // backward-compat alias
  };
}

export function useProjects() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fastApi<any[]>("GET", "/get-projects");
      setProjects((data || []).map(_mapProject));
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to load projects", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const createProject = useCallback(async (name: string, systemPrompt?: string) => {
    try {
      const data = await fastApi<any>("POST", "/create-project", {
        name,
        description: systemPrompt || null,
      });
      const project = _mapProject(data);
      setProjects(prev => [project, ...prev]);
      return project;
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to create project", variant: "destructive" });
      return null;
    }
  }, [toast]);

  const updateProject = useCallback(async (
    id: string,
    updates: { name?: string; system_prompt?: string | null; note_template?: string | null },
  ) => {
    try {
      const data = await fastApi<any>("PUT", `/update-project/${id}`, {
        name: updates.name,
        description: updates.system_prompt,  // map system_prompt → description
        note_template: updates.note_template,
      });
      const project = _mapProject(data);
      setProjects(prev => prev.map(p => p.id === id ? project : p));
      return true;
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to update project", variant: "destructive" });
      return false;
    }
  }, [toast]);

  const deleteProject = useCallback(async (id: string) => {
    try {
      await fastApi("DELETE", `/delete-project/${id}`);
      setProjects(prev => prev.filter(p => p.id !== id));
      return true;
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to delete project", variant: "destructive" });
      return false;
    }
  }, [toast]);

  return { projects, loading, fetchProjects, createProject, updateProject, deleteProject };
}

export function useProjectChats(projectId: string | null) {
  const { toast } = useToast();
  const [chats, setChats] = useState<ProjectChat[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchChats = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await fastApi<any[]>("GET", `/get-project-chats?project_id=${projectId}`);
      setChats(data || []);
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to load chats", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => { fetchChats(); }, [fetchChats]);

  const createChat = useCallback(async (title?: string) => {
    if (!projectId) return null;
    try {
      const data = await fastApi<any>(
        "POST",
        `/create-project-chat?project_id=${projectId}`,
        { title: title || "New Chat" },
      );
      setChats(prev => [data, ...prev]);
      return data as ProjectChat;
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to create chat", variant: "destructive" });
      return null;
    }
  }, [projectId, toast]);

  const updateChatTitle = useCallback(async (chatId: string, title: string) => {
    try {
      await fastApi("PUT", `/update-chat/${chatId}`, { title });
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, title } : c));
    } catch {
      // non-critical
    }
  }, []);

  const deleteChat = useCallback(async (chatId: string) => {
    try {
      await fastApi("DELETE", `/delete-chat/${chatId}`);
      setChats(prev => prev.filter(c => c.id !== chatId));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { chats, loading, fetchChats, createChat, updateChatTitle, deleteChat };
}

export function useProjectChat(chatId: string | null) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const fetchAndSetMessages = useCallback(async (targetChatId: string) => {
    try {
      const data = await fastApi<any[]>("GET", `/get-chat-messages?chat_id=${targetChatId}`);
      setMessages((data || []) as ChatMessage[]);
    } catch {
      // non-critical refresh
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!chatId) { setMessages([]); return; }
    setLoading(true);
    try {
      const data = await fastApi<any[]>("GET", `/get-chat-messages?chat_id=${chatId}`);
      setMessages((data || []) as ChatMessage[]);
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to load messages", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [chatId, toast]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  const sendMessage = useCallback(async (
    message: string,
    overrideChatId?: string,
    attachments: import("@/hooks/useNormanChat").ChatAttachment[] = [],
  ) => {
    const targetChatId = overrideChatId || chatId;
    if (!targetChatId || (!message.trim() && attachments.length === 0)) return null;
    setSending(true);

    const displayName = currentUserDisplayName();
    const userText = message.trim() || "Analyze the attached file(s)";

    const tempUserMsg: ChatMessage = {
      id: `temp-user-${Date.now()}`,
      chat_id: targetChatId,
      role: "user",
      content: userText,
      created_at: new Date().toISOString(),
      user_id: null,
      sender_name: displayName,
      sender_avatar_url: null,
    };
    const tempAssistantId = `temp-assistant-${Date.now()}`;
    const tempAssistantMsg: ChatMessage = {
      id: tempAssistantId,
      chat_id: targetChatId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
      user_id: null,
      sender_name: null,
      sender_avatar_url: null,
    };
    setMessages(prev => [...prev, tempUserMsg, tempAssistantMsg]);

    let assistantSoFar = "";
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages(prev => prev.map(m => m.id === tempAssistantId ? { ...m, content: assistantSoFar } : m));
    };

    try {
      const token = getAuthToken() || "";
      const apiBase = import.meta.env.VITE_API_BASE_URL;
      const extractUrl = `${apiBase}/files/extract`;

      const enriched = await Promise.all(attachments.map(async (att) => {
        if (att.type.startsWith("image/") || att.extractedText) return att;
        try {
          const resp = await fetch(extractUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ file_name: att.name, file_type: att.type, base64: att.base64 }),
          });
          if (resp.ok) {
            const data = await resp.json();
            return { ...att, extractedText: data.text || "" };
          }
        } catch (err) {
          console.warn("Project chat: extraction failed for", att.name, err);
        }
        return att;
      }));

      const resp = await fetch(`${apiBase}/chat-with-project-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          chat_id: targetChatId,
          message: userText,
          attachments: enriched.map((a) => ({
            name: a.name,
            type: a.type,
            base64: a.type.startsWith("image/") ? a.base64 : undefined,
            extractedText: a.extractedText,
          })),
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${resp.status})`);
      }

      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream") && resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;
        while (!done) {
          const { done: d, value } = await reader.read();
          if (d) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") { done = true; break; }
            try {
              const parsed = JSON.parse(data);
              const c = parsed.choices?.[0]?.delta?.content;
              if (c) upsertAssistant(c);
            } catch { /* skip */ }
          }
        }
      } else {
        const data = await resp.json().catch(() => ({}));
        if (data?.reply) upsertAssistant(data.reply);
      }

      await fetchAndSetMessages(targetChatId);
      return assistantSoFar || null;
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to get response", variant: "destructive" });
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id && m.id !== tempAssistantId));
      return null;
    } finally {
      setSending(false);
    }
  }, [chatId, fetchAndSetMessages, toast]);

  return { messages, loading, sending, sendMessage, fetchMessages };
}

export function useProjectFiles(projectId: string | null) {
  const { toast } = useToast();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<Set<string>>(new Set());
  const [extractingFiles, setExtractingFiles] = useState<Set<string>>(new Set());

  const fetchFiles = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await fastApi<any[]>("GET", `/get-project-files/${projectId}`);
      setFiles((data || []) as ProjectFile[]);
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to load files", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const uploadFile = useCallback(async (file: File) => {
    if (!projectId) return null;
    const tempId = `uploading-${file.name}`;
    setUploadingFiles(prev => new Set(prev).add(tempId));

    const formData = new FormData();
    formData.append("project_id", projectId);
    formData.append("file", file);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/upload-project-file`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${getAuthToken() || ""}` },
          body: formData,
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || err.error || "Upload failed");
      }

      const fileRecord = await response.json();
      await fetchFiles();
      toast({ title: "File uploaded", description: `${file.name} — indexed automatically` });
      return fileRecord as ProjectFile;
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      return null;
    } finally {
      setUploadingFiles(prev => {
        const next = new Set(prev);
        next.delete(tempId);
        return next;
      });
    }
  }, [projectId, fetchFiles, toast]);

  const extractText = useCallback(async (fileId: string) => {
    setExtractingFiles(prev => new Set(prev).add(fileId));
    try {
      const data = await fastApi<{ chunks_created?: number; text_length?: number }>(
        "POST", "/files/extract", { file_id: fileId },
      );
      await fetchFiles();
      toast({ title: "File indexed", description: `${data?.chunks_created || 0} chunks created` });
      return true;
    } catch (err: any) {
      toast({ title: "Extraction failed", description: err.message, variant: "destructive" });
      return false;
    } finally {
      setExtractingFiles(prev => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  }, [fetchFiles, toast]);

  const deleteFile = useCallback(async (fileId: string) => {
    try {
      await fastApi("DELETE", `/delete-project-file/${fileId}`);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      toast({ title: "File deleted" });
      return true;
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
      return false;
    }
  }, [toast]);

  return {
    files, loading, fetchFiles, uploadFile, extractText, deleteFile,
    isUploading: uploadingFiles.size > 0,
    isExtracting: (fileId: string) => extractingFiles.has(fileId),
  };
}

export function useProjectMembers(projectId: string | null) {
  const { toast } = useToast();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMembers = useCallback(async () => {
    if (!projectId) { setMembers([]); return; }
    setLoading(true);
    try {
      const data = await fastApi<ProjectMember[]>("GET", `/get-project-members/${projectId}`);
      setMembers(data || []);
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to load project members", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const addMember = useCallback(async (userId: string) => {
    if (!projectId || !userId) return false;
    try {
      await fastApi("POST", `/add-project-member?project_id=${projectId}`, {
        user_id: userId,
        role: "member",
      });
      try {
        await fastApi("POST", "/project-member-added-email", {
          project_id: projectId,
          user_id: userId,
        });
      } catch {
        // email notification is non-critical
      }
      await fetchMembers();
      toast({ title: "Member added", description: "Project access has been shared." });
      return true;
    } catch (err: any) {
      const isDuplicate = err.message?.includes("409") || err.message?.includes("already");
      toast({
        title: isDuplicate ? "Already a member" : "Error",
        description: isDuplicate ? "This user already has access to the project." : (err.message || "Failed to add member"),
        variant: isDuplicate ? "default" : "destructive",
      });
      return false;
    }
  }, [fetchMembers, projectId, toast]);

  const removeMember = useCallback(async (userId: string) => {
    if (!projectId || !userId) return false;
    try {
      await fastApi("DELETE", `/remove-project-member/${projectId}/${userId}`);
      await fetchMembers();
      toast({ title: "Member removed", description: "Project access has been removed." });
      return true;
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to remove member", variant: "destructive" });
      return false;
    }
  }, [fetchMembers, projectId, toast]);

  return { members, loading, addMember, removeMember, refetchMembers: fetchMembers };
}
