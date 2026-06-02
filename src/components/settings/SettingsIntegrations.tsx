import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Mail, MessageSquare, Calendar, HardDrive, GitBranch, Database,
  FolderOpen, ExternalLink, Loader2, Lock, CheckCircle2
} from "lucide-react";
import { useUserIntegrations } from "@/hooks/useUserIntegrations";
import { useCompanyIntegrations } from "@/hooks/useCompanyIntegrations";
import { useGoogleCalendar } from "@/hooks/useGoogleCalendar";
import { useSlackConnection } from "@/hooks/useSlackConnection";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  icon: React.ElementType;
  category: string;
  scope: "user" | "company";
};

const rows: Row[] = [
  { id: "gmail", name: "Gmail", icon: Mail, category: "Productivity", scope: "user" },
  { id: "slack", name: "Slack", icon: MessageSquare, category: "Communication", scope: "user" },
  { id: "google-calendar", name: "Google Calendar", icon: Calendar, category: "Productivity", scope: "user" },
  { id: "google-drive", name: "Google Drive", icon: HardDrive, category: "Productivity", scope: "company" },
  { id: "azure-devops", name: "Azure DevOps", icon: GitBranch, category: "Operations", scope: "company" },
  { id: "azure-blob", name: "Azure Blob Storage", icon: FolderOpen, category: "Knowledge", scope: "company" },
  { id: "hubspot", name: "HubSpot", icon: Database, category: "Revenue", scope: "company" },
];

interface Props {
  onNavigate: () => void;
}

export default function SettingsIntegrations({ onNavigate }: Props) {
  const navigate = useNavigate();
  const { data: userInts = [], isLoading: userLoading } = useUserIntegrations();
  const { data: companyInts = [], isLoading: companyLoading } = useCompanyIntegrations();
  const { isConnected: calConnected } = useGoogleCalendar();
  const slack = useSlackConnection();

  const isLoading = userLoading || companyLoading;

  const statusFor = (r: Row): "connected" | "disconnected" => {
    if (r.id === "google-calendar") return calConnected ? "connected" : "disconnected";
    if (r.id === "slack") return slack.isConnected ? "connected" : "disconnected";
    const pool = r.scope === "company" ? companyInts : userInts;
    const found = pool.find((p: any) => p.integration_id === r.id);
    return found?.status === "connected" ? "connected" : "disconnected";
  };

  const goManage = () => {
    onNavigate();
    navigate("/integrations");
  };

  const connectedCount = rows.filter((r) => statusFor(r) === "connected").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1">Integrations</h3>
          <p className="text-xs text-muted-foreground">
            {connectedCount} of {rows.length} connected. Manage credentials, scopes, and shared access.
          </p>
        </div>
        <button
          onClick={goManage}
          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/70 transition-colors"
        >
          Open full page
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
          {rows.map((r) => {
            const status = statusFor(r);
            const connected = status === "connected";
            const Icon = r.icon;
            return (
              <button
                key={r.id}
                onClick={goManage}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/40 transition-colors"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary shrink-0">
                  <Icon className="h-4 w-4 text-secondary-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                    {r.scope === "company" && (
                      <span className="flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                        <Lock className="h-2.5 w-2.5" />
                        Company
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mt-0.5">
                    {r.category}
                  </p>
                </div>
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 shrink-0",
                    connected
                      ? "bg-norman-success/10 border-norman-success/20 text-norman-success"
                      : "bg-muted/40 border-border text-muted-foreground"
                  )}
                >
                  {connected ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                  )}
                  <span className="text-[10px] font-medium">
                    {connected ? "Connected" : "Not connected"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/70">
        Click any integration to open the full integrations page where you can connect, reconnect, or disconnect.
      </p>
    </div>
  );
}
