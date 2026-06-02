import { useState } from "react";
import {
  Mail, MessageSquare, Calendar, HardDrive, GitBranch, Database,
  FolderOpen, Loader2, Lock, CheckCircle2, Shield, ExternalLink
} from "lucide-react";
import { useUserIntegrations } from "@/hooks/useUserIntegrations";
import { useCompanyIntegrations } from "@/hooks/useCompanyIntegrations";
import { useGoogleCalendar } from "@/hooks/useGoogleCalendar";
import { useSlackConnection } from "@/hooks/useSlackConnection";
import { useGmailStatus, useGmailConnect, useGmailDisconnect } from "@/hooks/useGmailIntegration";
import { useIsAdmin } from "@/hooks/useUserRoles";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  icon: React.ElementType;
  category: string;
  scope: "user" | "company";
  description: string;
};

const rows: Row[] = [
  { id: "gmail", name: "Gmail", icon: Mail, category: "Productivity", scope: "user", description: "Read and compose email from your personal mailbox inside Duncan." },
  { id: "slack", name: "Slack", icon: MessageSquare, category: "Communication", scope: "user", description: "Send direct messages and notifications to your Slack account." },
  { id: "google-calendar", name: "Google Calendar", icon: Calendar, category: "Productivity", scope: "user", description: "Read, create and modify events on your calendars." },
  { id: "google-drive", name: "Google Drive", icon: HardDrive, category: "Productivity", scope: "company", description: "Shared company drive used for weekly reports and document ingestion." },
  { id: "azure-devops", name: "Azure DevOps", icon: GitBranch, category: "Operations", scope: "company", description: "Work items, boards and sync logs from the company Azure DevOps tenant." },
  { id: "azure-blob", name: "Azure Blob Storage", icon: FolderOpen, category: "Knowledge", scope: "company", description: "Document store backing the knowledge base and authenticated downloads." },
  { id: "hubspot", name: "HubSpot", icon: Database, category: "Revenue", scope: "company", description: "Read-only pipeline summaries and CRM search inside chat." },
];

interface Props {
  onNavigate: () => void;
}

export default function SettingsIntegrations({ onNavigate: _onNavigate }: Props) {
  const { data: userInts = [], isLoading: userLoading } = useUserIntegrations();
  const { data: companyInts = [], isLoading: companyLoading } = useCompanyIntegrations();
  const { isConnected: calConnected, initiateOAuth: calConnect, disconnect: calDisconnect } = useGoogleCalendar();
  const slack = useSlackConnection();
  const gmailStatus = useGmailStatus();
  const gmailConnect = useGmailConnect();
  const gmailDisconnect = useGmailDisconnect();
  const { isAdmin } = useIsAdmin();
  const [openRow, setOpenRow] = useState<Row | null>(null);

  const isLoading = userLoading || companyLoading;

  const statusFor = (r: Row): "connected" | "disconnected" => {
    if (r.id === "google-calendar") return calConnected ? "connected" : "disconnected";
    if (r.id === "slack") return slack.isConnected ? "connected" : "disconnected";
    if (r.id === "gmail") return gmailStatus.data?.connected ? "connected" : "disconnected";
    const pool = r.scope === "company" ? companyInts : userInts;
    const found = pool.find((p: any) => p.integration_id === r.id);
    return found?.status === "connected" ? "connected" : "disconnected";
  };

  const connectedCount = rows.filter((r) => statusFor(r) === "connected").length;

  const renderDetailActions = (r: Row) => {
    const connected = statusFor(r) === "connected";

    if (r.id === "gmail") {
      return connected ? (
        <Button variant="destructive" size="sm" onClick={() => gmailDisconnect.mutate()} disabled={gmailDisconnect.isPending}>
          {gmailDisconnect.isPending ? "Disconnecting…" : "Disconnect Gmail"}
        </Button>
      ) : (
        <Button size="sm" onClick={() => gmailConnect.connect()} disabled={gmailConnect.loading}>
          {gmailConnect.loading ? "Opening…" : "Connect Gmail"}
        </Button>
      );
    }

    if (r.id === "google-calendar") {
      return connected ? (
        <Button variant="destructive" size="sm" onClick={() => calDisconnect()}>Disconnect Calendar</Button>
      ) : (
        <Button size="sm" onClick={() => calConnect()}>Connect Calendar</Button>
      );
    }

    if (r.id === "slack") {
      return connected ? (
        <Button variant="destructive" size="sm" onClick={() => slack.disconnect()} disabled={slack.isDisconnecting}>
          {slack.isDisconnecting ? "Disconnecting…" : "Disconnect Slack"}
        </Button>
      ) : (
        <Button size="sm" onClick={() => slack.connect()}>Connect Slack</Button>
      );
    }

    // Company-scoped integrations
    if (!isAdmin) {
      return (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Shield className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Company integrations are managed by an administrator. Contact an admin to change credentials or scopes.</span>
        </div>
      );
    }

    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>Credentials for {r.name} are configured server-side. Update the connector secret in Lovable Cloud to rotate access.</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Integrations</h3>
        <p className="text-xs text-muted-foreground">
          {connectedCount} of {rows.length} connected. Click any row for details and actions.
        </p>
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
                onClick={() => setOpenRow(r)}
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

      <Dialog open={!!openRow} onOpenChange={(o) => !o && setOpenRow(null)}>
        <DialogContent className="sm:max-w-md">
          {openRow && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary shrink-0">
                    <openRow.icon className="h-5 w-5 text-secondary-foreground" />
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-base">{openRow.name}</DialogTitle>
                    <DialogDescription className="text-[11px] font-mono uppercase tracking-wider mt-0.5">
                      {openRow.category} · {openRow.scope === "company" ? "Company" : "Personal"}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <p className="text-sm text-muted-foreground leading-6">{openRow.description}</p>

                <div
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
                    statusFor(openRow) === "connected"
                      ? "bg-norman-success/10 border-norman-success/20 text-norman-success"
                      : "bg-muted/40 border-border text-muted-foreground"
                  )}
                >
                  {statusFor(openRow) === "connected" ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                  )}
                  <span className="font-medium">
                    {statusFor(openRow) === "connected" ? "Connected" : "Not connected"}
                  </span>
                </div>

                <div>{renderDetailActions(openRow)}</div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
