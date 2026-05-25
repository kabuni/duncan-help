import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Home, Layers, LayoutDashboard, Calendar, BookOpen, Inbox, GitBranch, Receipt,
  Plug, Settings as SettingsIcon, MessageSquarePlus, Sparkles, Mail,
  FileText, Users, Crown, Megaphone,
} from "lucide-react";
import { useGeneralChatsContext } from "@/hooks/GeneralChatsContext";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CommandPalette = ({ open, onOpenChange }: CommandPaletteProps) => {
  const navigate = useNavigate();
  const chatOps = useGeneralChatsContext();

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  const startNewChat = () => {
    onOpenChange(false);
    chatOps.startNewChat();
    navigate("/", { state: { newChat: true } });
  };

  const askDuncan = (prompt: string) => {
    onOpenChange(false);
    chatOps.startNewChat();
    navigate("/", { state: { newChat: true, prefill: prompt } });
  };

  const recentChats = useMemo(() => chatOps.chats.slice(0, 5), [chatOps.chats]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search, navigate, or ask Duncan…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Ask Duncan">
          <CommandItem onSelect={() => askDuncan("Brief me on today")}>
            <Sparkles className="mr-2 h-4 w-4" />
            Brief me on today
          </CommandItem>
          <CommandItem onSelect={() => askDuncan("What is red or at risk this week?")}>
            <Sparkles className="mr-2 h-4 w-4" />
            What is red or at risk this week?
          </CommandItem>
          <CommandItem onSelect={() => askDuncan("Draft an investor update from this week's activity")}>
            <Sparkles className="mr-2 h-4 w-4" />
            Draft an investor update
          </CommandItem>
          <CommandItem onSelect={() => askDuncan("Summarise my pending approvals and recommend decisions")}>
            <Sparkles className="mr-2 h-4 w-4" />
            Summarise my pending approvals
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick actions">
          <CommandItem onSelect={startNewChat}>
            <MessageSquarePlus className="mr-2 h-4 w-4" />
            New chat with Duncan
          </CommandItem>
          <CommandItem onSelect={() => go("/workstreams")}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Open Workstreams board
          </CommandItem>
          <CommandItem onSelect={() => go("/diary")}>
            <Calendar className="mr-2 h-4 w-4" />
            Open Planner
          </CommandItem>
          <CommandItem onSelect={() => go("/purchase-orders")}>
            <Receipt className="mr-2 h-4 w-4" />
            New authorisation request
          </CommandItem>
          <CommandItem onSelect={() => go("/knowledge-base")}>
            <BookOpen className="mr-2 h-4 w-4" />
            Upload to Knowledge Base
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go("/")}>
            <Home className="mr-2 h-4 w-4" /> Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go("/projects")}>
            <Layers className="mr-2 h-4 w-4" /> Projects
          </CommandItem>
          <CommandItem onSelect={() => go("/workstreams")}>
            <LayoutDashboard className="mr-2 h-4 w-4" /> Workstreams
          </CommandItem>
          <CommandItem onSelect={() => go("/diary")}>
            <Calendar className="mr-2 h-4 w-4" /> Planner
          </CommandItem>
          <CommandItem onSelect={() => go("/knowledge-base")}>
            <BookOpen className="mr-2 h-4 w-4" /> Knowledge Base
          </CommandItem>
          <CommandItem onSelect={() => go("/approvals")}>
            <Inbox className="mr-2 h-4 w-4" /> Approvals
          </CommandItem>
          <CommandItem onSelect={() => go("/operations")}>
            <GitBranch className="mr-2 h-4 w-4" /> Operations
          </CommandItem>
          <CommandItem onSelect={() => go("/purchase-orders")}>
            <Receipt className="mr-2 h-4 w-4" /> Authorisation Requests
          </CommandItem>
          <CommandItem onSelect={() => go("/recruitment")}>
            <Users className="mr-2 h-4 w-4" /> Recruitment
          </CommandItem>
          <CommandItem onSelect={() => go("/gmail")}>
            <Mail className="mr-2 h-4 w-4" /> Gmail
          </CommandItem>
          <CommandItem onSelect={() => go("/team-briefing")}>
            <Crown className="mr-2 h-4 w-4" /> Team Briefing
          </CommandItem>
          <CommandItem onSelect={() => go("/whats-new")}>
            <Megaphone className="mr-2 h-4 w-4" /> What's New
          </CommandItem>
          <CommandItem onSelect={() => go("/integrations")}>
            <Plug className="mr-2 h-4 w-4" /> Integrations
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            <SettingsIcon className="mr-2 h-4 w-4" /> Settings
          </CommandItem>
        </CommandGroup>

        {recentChats.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent chats">
              {recentChats.map((c) => (
                <CommandItem
                  key={c.id}
                  onSelect={() => {
                    onOpenChange(false);
                    chatOps.setActiveChatId(c.id);
                    navigate("/");
                  }}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  <span className="truncate">{c.title || "Untitled chat"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
};

export const useCommandPaletteShortcut = (setOpen: (v: boolean | ((p: boolean) => boolean)) => void) => {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((p: boolean) => !p);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [setOpen]);
};
