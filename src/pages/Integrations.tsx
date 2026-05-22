import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail, FileText, MessageSquare, Calendar, FolderOpen,
  CheckCircle2, AlertCircle, ArrowRight, X, Plug, Shield,
  Clock, Database, Zap, Loader2, Lock, ExternalLink,
  GitBranch, HardDrive
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { invokeEdge } from "@/lib/edgeApi";
import { fastApi, withFastApi } from "@/lib/fastApiClient";
import { useGoogleCalendar } from "@/hooks/useGoogleCalendar";
import { useSlackConnection } from "@/hooks/useSlackConnection";
import { useAzureBlobStorage } from "@/hooks/useAzureBlobStorage";

import {
  useUserIntegrations,
  useConnectIntegration,
  useDisconnectIntegration,
  type UserIntegration,
} from "@/hooks/useUserIntegrations";
import {
  useCompanyIntegrations,
  useUpdateCompanyIntegration,
  type CompanyIntegration,
} from "@/hooks/useCompanyIntegrations";
import { useIsAdmin } from "@/hooks/useUserRoles";

type IntegrationStatus = "connected" | "pending" | "disconnected";
type StoredIntegrationStatus = IntegrationStatus | "degraded" | string | null | undefined;
type IntegrationType = "user" | "company";

type GoogleDriveStatusDetail = {
  status?: "connected" | "degraded" | "disconnected";
  connected?: boolean;
  credential_source?: string;
  account_email?: string | null;
  account_name?: string | null;
  token_expiry?: string | null;
  updated_at?: string | null;
  last_verified_at?: string | null;
  visible_file_count?: number;
  sample_files?: Array<{ id: string; name: string; mimeType?: string; modifiedTime?: string }>;
  degraded_reason?: string;
  error?: string;
};

const driveErrorMessages: Record<string, string> = {
  no_code: "Google Drive authorization was cancelled before Duncan received a code.",
  invalid_state: "Google Drive authorization returned an invalid state. Please start the connection again.",
  token_exchange_failed: "Google rejected the authorization code. Check the Drive redirect URI and OAuth client settings.",
  storage_failed: "Google Drive authorized successfully, but Duncan could not save the token.",
  unknown: "An unexpected Google Drive connection error occurred.",
};

const getRuntimeStatusLabel = (detail: any | null | undefined) => {
  if (!detail) return null;
  const source = detail.credential_source === "connector_gateway"
    ? "Connector"
    : detail.credential_source === "stored_token"
    ? "Stored token"
    : "No credential";

  const code = String(detail.error_code || "");
  if (!code) return detail.status === "connected" ? `${source} verified` : null;

  if (code.includes("not_configured") || code.includes("missing")) return `${source} missing`;
  if (code.includes("insufficient_scope")) return `${source} missing permissions`;
  if (code.includes("expired")) return `${source} expired or revoked`;
  if (code.includes("mismatch")) return `${source} verification mismatch`;
  if (code.includes("invalid_token") || code.includes("invalid")) return `${source} invalid`;
  if (code.includes("rate_limited")) return `${source} rate limited`;
  return `${source} ${code.replace(/_/g, " ")}`;
};

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  category: string;
  services: string[];
  setupSteps: string[];
  type: IntegrationType; // "user" = per-user, "company" = shared company-wide
}

const integrations: Integration[] = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Read, search, and send emails directly from Duncan. Per-user connection — your inbox stays private.",
    icon: Mail,
    category: "Productivity",
    services: ["Read Emails", "Search", "Send", "Compose"],
    type: "user",
    setupSteps: [
      "Click Connect Gmail below",
      "Sign in with your Google account and grant permissions",
      "You'll be redirected back to Duncan — that's it!",
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Surface channel activity into Team Briefing with explicit degraded visibility when Duncan cannot see private or unjoined channels.",
    icon: MessageSquare,
    category: "Communication",
    services: ["Channels", "Direct Messages", "Threads", "Reactions"],
    type: "user",
    setupSteps: [
      "Click Connect Slack below",
      "Approve the requested Slack permissions in the Slack consent screen",
      "You'll be redirected back to Duncan when the connection is saved",
    ],
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Dedicated calendar sync for scheduling intelligence and meeting automation.",
    icon: Calendar,
    category: "Productivity",
    services: ["Events", "Calendars", "Reminders"],
    type: "user",
    setupSteps: [
      "Uses your Google Workspace credentials",
      "Enable the Calendar API in your Google Cloud project",
      "Duncan will automatically sync upcoming and past events",
    ],
  },
  {
    id: "azure-blob",
    name: "Azure Blob Storage",
    description: "Company-wide document storage. Duncan can search and read files across your Azure Blob Storage to answer questions based on your docs.",
    icon: FolderOpen,
    category: "Knowledge",
    services: ["Documents", "NDAs", "Templates", "File Storage"],
    type: "company",
    setupSteps: [
      "Azure Blob Storage connection string is configured as a backend secret",
      "The storage container 'duncanstorage01' is used for all documents",
      "Documents are organized in folders: documents/, ndas/, templates/",
      "Duncan can search, list, and read file contents automatically",
    ],
  },
  {
    id: "azure-devops",
    name: "Azure DevOps",
    description: "Sync work items from Azure Boards. Duncan reasons over project tickets, delivery status, and operational risks.",
    icon: GitBranch,
    category: "Operations",
    services: ["Work Items", "Boards", "Sprints", "Queries"],
    type: "company",
    setupSteps: [
      "Register an app in Azure Portal → App registrations",
      "Add redirect URI: your backend callback URL",
      "Add API permission: Azure DevOps → user_impersonation",
      "An admin connects via OAuth to authorize access",
    ],
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Shared Google Drive access for reading and searching files. Duncan can navigate folders, read documents, and synthesize reports across the connected workspace.",
    icon: HardDrive,
    category: "Productivity",
    services: ["File Browsing", "Folder Navigation", "Document Reading", "Report Synthesis"],
    type: "company",
    setupSteps: [
      "An admin clicks Connect Google Drive below",
      "Sign in with Google and grant read-only access to the shared Drive workspace",
      "You'll be redirected back to Duncan and the connection becomes available across the company",
    ],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "Pull CRM risk and pipeline signals into Team Briefing without breaking generation when CRM data is unavailable.",
    icon: Database,
    category: "Revenue",
    services: ["Accounts", "Deals", "Risk Signals", "Team Briefing"],
    type: "company",
    setupSteps: [
      "Connect HubSpot from Connectors at the workspace level",
      "Link the connection to this project so backend functions can read CRM data",
      "Duncan verifies connection health before using HubSpot evidence in Team Briefing",
      "If HubSpot is not connected, Team Briefing still runs and flags the CRM blind spot",
    ],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Add engineering delivery and PR blockage signals to Team Briefing with graceful not-configured fallback.",
    icon: GitBranch,
    category: "Engineering",
    services: ["Repositories", "Pull Requests", "Release Risks", "Team Briefing"],
    type: "company",
    setupSteps: [
      "Connect GitHub from Connectors at the workspace level",
      "Link the connection to this project when the workspace connection is ready",
      "Duncan checks GitHub status before using repo evidence in Team Briefing",
      "If GitHub is unavailable, the briefing still completes and marks engineering visibility as reduced",
    ],
  },
];

const hiddenIntegrationIds = new Set(["azure-blob", "github", "hubspot"]);
const baseVisibleIntegrations = integrations.filter((integration) => !hiddenIntegrationIds.has(integration.id));

const statusConfig: Record<IntegrationStatus, { label: string; color: string; dot: string; bg: string }> = {
  connected: { label: "Connected", color: "text-norman-success", dot: "bg-norman-success", bg: "bg-norman-success/10 border-norman-success/20" },
  pending: { label: "Pending", color: "text-norman-warning", dot: "bg-norman-warning", bg: "bg-norman-warning/10 border-norman-warning/20" },
  disconnected: { label: "Not connected", color: "text-muted-foreground", dot: "bg-muted-foreground", bg: "bg-muted/50 border-border" },
};

function normalizeStatus(status: StoredIntegrationStatus): IntegrationStatus {
  if (status === "connected" || status === "pending" || status === "disconnected") return status;
  if (status === "degraded") return "pending";
  return "disconnected";
}

function getStatus(
  integration: Integration,
  userIntegrations: UserIntegration[],
  companyIntegrations: CompanyIntegration[]
): IntegrationStatus {
  if (integration.type === "company") {
    const ci = companyIntegrations.find((c) => c.integration_id === integration.id);
    if (!ci) return "disconnected";
    return normalizeStatus(ci.status);
  }
  const ui = userIntegrations.find((u) => u.integration_id === integration.id);
  if (!ui) return "disconnected";
  return normalizeStatus(ui.status);
}

function getIntegrationData(
  integration: Integration,
  userIntegrations: UserIntegration[],
  companyIntegrations: CompanyIntegration[]
) {
  if (integration.type === "company") {
    return companyIntegrations.find((c) => c.integration_id === integration.id);
  }
  return userIntegrations.find((u) => u.integration_id === integration.id);
}

const Integrations = () => {
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: userIntegrations = [], isLoading: userLoading } = useUserIntegrations();
  const { data: companyIntegrations = [], isLoading: companyLoading } = useCompanyIntegrations();
  const { isAdmin } = useIsAdmin();
  const { isConnected: isCalendarConnected, checkConnection: checkCalendarConnection } = useGoogleCalendar();
  const slackConnection = useSlackConnection();
  const [isAzureBlobConnected, setIsAzureBlobConnected] = useState<boolean | null>(null);
  
  const [isGmailConnected, setIsGmailConnected] = useState<boolean | null>(null);
  const [isAzureDevOpsConnected, setIsAzureDevOpsConnected] = useState<boolean | null>(null);
  const [isGoogleDriveConnected, setIsGoogleDriveConnected] = useState<boolean | null>(null);
  const [googleDriveStatus, setGoogleDriveStatus] = useState<GoogleDriveStatusDetail | null>(null);
  const checkAzureBlobConnection = async () => {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase.rpc("get_company_integrations_status");
      const row = (data ?? []).find((r: any) => r.integration_id === "azure-blob");
      setIsAzureBlobConnected(row?.status === "connected");
    } catch {
      setIsAzureBlobConnected(false);
    }
  };

  

  const checkGmailConnection = async () => {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsGmailConnected(false); return; }
      const { data } = await supabase.from("gmail_tokens").select("id").eq("connected_by", user.id).limit(1);
      setIsGmailConnected(data && data.length > 0);
    } catch {
      setIsGmailConnected(false);
    }
  };

  const checkAzureDevOpsConnection = async () => {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      // Probe live connectivity (works for both PAT and OAuth-token modes)
      const { data, error } = await supabase.functions.invoke("azure-devops-api", {
        body: { action: "list_projects" },
      });
      if (error) {
        setIsAzureDevOpsConnected(false);
        return;
      }
      setIsAzureDevOpsConnected(!data?.error);
    } catch {
      setIsAzureDevOpsConnected(false);
    }
  };


  const checkGoogleDriveConnection = async () => {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("google-drive-api", {
        body: { action: "status" },
      });
      if (error) throw error;
      setGoogleDriveStatus(data as GoogleDriveStatusDetail);
      setIsGoogleDriveConnected(data?.status === "connected" || data?.connected === true);
    } catch (error) {
      setGoogleDriveStatus({
        status: "degraded",
        connected: false,
        degraded_reason: error instanceof Error ? error.message : "Unable to verify Google Drive connection",
      });
      setIsGoogleDriveConnected(false);
    }
  };

  // Handle OAuth callback
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    
    if (success === "google_calendar") {
      toast.success("Google Calendar connected successfully!");
      checkCalendarConnection();
      setSearchParams({});
    } else if (success === "azure_blob") {
      toast.success("Azure Blob Storage connected successfully!");
      checkAzureBlobConnection();
      setSearchParams({});
    } else if (success === "azure_devops") {
      toast.success("Azure DevOps connected successfully!");
      checkAzureDevOpsConnection();
      setSearchParams({});
    } else if (searchParams.get("drive_connected") === "true") {
      toast.success("Google Drive connected successfully!");
      checkGoogleDriveConnection();
      setSearchParams({});
    } else if (searchParams.get("drive_error")) {
      const driveError = searchParams.get("drive_error");
      toast.error(driveErrorMessages[driveError || "unknown"] || `Google Drive connection failed: ${driveError}`);
      setSearchParams({});
    } else if (searchParams.get("gmail_connected") === "true") {
      toast.success("Gmail connected successfully!");
      checkGmailConnection();
      setSearchParams({});
    } else if (searchParams.get("gmail_error")) {
      const gmailError = searchParams.get("gmail_error");
      const errorMessages: Record<string, string> = {
        no_code: "Gmail OAuth flow was cancelled",
        token_exchange_failed: "Failed to exchange Gmail authorization code",
        storage_failed: "Failed to save Gmail credentials",
        unknown: "An unexpected Gmail error occurred",
      };
      toast.error(errorMessages[gmailError || "unknown"] || `Gmail connection failed: ${gmailError}`);
      setSearchParams({});
    } else if (searchParams.get("slack_connected") === "true") {
      toast.success("Slack connected successfully!");
      slackConnection.refetch();
      setSearchParams({});
    } else if (searchParams.get("slack_error")) {
      toast.error("Slack connection failed");
      setSearchParams({});
    } else if (error) {
      const errorMessages: Record<string, string> = {
        missing_params: "OAuth flow was incomplete",
        config_error: "Google credentials not configured",
        invalid_state: "Invalid OAuth state",
        unauthorized: "Authentication failed",
        admin_required: "Admin access required to connect this integration",
        token_exchange_failed: "Failed to exchange authorization code",
        storage_failed: "Failed to save credentials",
        unexpected: "An unexpected error occurred",
      };
      toast.error(errorMessages[error] || `Connection failed: ${error}`);
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, checkCalendarConnection, slackConnection]);

  // Check OAuth connections on mount
  useEffect(() => {
    checkCalendarConnection();
    checkAzureBlobConnection();
    
    checkGmailConnection();
    checkAzureDevOpsConnection();
    checkGoogleDriveConnection();
  }, [checkCalendarConnection]);

  const isLoading = userLoading || companyLoading || slackConnection.isLoading;

  const getRealtimeStatus = (integration: Integration): IntegrationStatus => {
    const oauthMap: Record<string, boolean | null> = {
      "gmail": isGmailConnected,
      "slack": slackConnection.isConnected,
      "google-calendar": isCalendarConnected,
      "azure-blob": isAzureBlobConnected,
      "azure-devops": isAzureDevOpsConnected,
      "google-drive": isGoogleDriveConnected,
    };
    if (integration.id in oauthMap) {
      const val = oauthMap[integration.id];
      if (val === null) return "disconnected"; // still loading
      return val ? "connected" : "disconnected";
    }
    return getStatus(integration, userIntegrations, companyIntegrations);
  };

  const visibleIntegrations = baseVisibleIntegrations;

  const categories = ["all", ...Array.from(new Set(visibleIntegrations.map((i) => i.category)))];
  const filtered = filter === "all" ? visibleIntegrations : visibleIntegrations.filter((i) => i.category === filter);

  const connectedCount = visibleIntegrations.filter((i) => getRealtimeStatus(i) === "connected").length;
  const userDocs = userIntegrations.reduce((sum, u) => sum + (u.documents_ingested ?? 0), 0);
  const companyDocs = companyIntegrations.reduce((sum, c) => sum + (c.documents_ingested ?? 0), 0);
  const totalDocs = userDocs + companyDocs;
  return (
    <>
      <main className="flex-1 overflow-y-auto">
        <div className="pointer-events-none fixed top-0 lg:left-64 left-0 right-0 h-72 gradient-radial z-0" />

        <div className="relative z-10 px-4 sm:px-8 py-6 sm:py-8 max-w-6xl">
          {/* Header */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Integrations</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Connect your tools so Duncan can ingest, reason, and automate across your stack.
            </p>
          </motion.div>


          {/* Filters */}
          <div className="flex items-center gap-2 mb-6 mt-4 overflow-x-auto scrollbar-thin -mx-1 px-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                  filter === cat
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                {cat === "all" ? "All" : cat}
              </button>
            ))}
          </div>

          {/* Loading state */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            /* Integration Grid */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((integration, i) => {
                const status = getRealtimeStatus(integration);
                const s = statusConfig[status];
                const integrationData = getIntegrationData(integration, userIntegrations, companyIntegrations);
                const isCompany = integration.type === "company";
                return (
                  <motion.div
                    key={integration.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                    onClick={() => setSelectedIntegration(integration)}
                    className="group cursor-pointer rounded-xl border border-border bg-card p-5 hover:border-primary/20 transition-all duration-300"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                          <integration.icon className="h-5 w-5 text-secondary-foreground" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-foreground">{integration.name}</h3>
                            {isCompany && (
                              <span className="flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                                <Lock className="h-2.5 w-2.5" />
                                Company
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{integration.category}</span>
                        </div>
                      </div>
                      <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${s.bg}`}>
                        <div className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                        <span className={`text-[10px] font-medium ${s.color}`}>{s.label}</span>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed mb-4">{integration.description}</p>

                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {integration.services.map((service) => (
                        <span key={service} className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
                          {service}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center justify-between">
                      {(integrationData?.last_sync || (integration.id === "hubspot" || integration.id === "github")) ? (
                        <div className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/50">
                          <Clock className="h-3 w-3" />
                          {integrationData?.last_sync ? `Last sync: ${new Date(integrationData.last_sync).toLocaleDateString()}` : "Runtime-diagnosed"}
                        </div>
                      ) : (
                        <span className="text-[10px] font-mono text-muted-foreground/30">Not synced yet</span>
                      )}
                      <div className="flex items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        {isCompany && !isAdmin ? "View" : "Configure"} <ArrowRight className="h-3 w-3" />
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail Modal */}
        <AnimatePresence>
          {selectedIntegration && (
            <IntegrationDetail
              integration={selectedIntegration}
              userIntegrations={userIntegrations}
              companyIntegrations={companyIntegrations}
              isAdmin={isAdmin}
              isCalendarConnected={isCalendarConnected}
              isAzureBlobConnected={isAzureBlobConnected}
              
              isGmailConnected={isGmailConnected}
              isSlackConnected={slackConnection.isConnected}
              slackWorkspaceName={slackConnection.workspaceName}
              isAzureDevOpsConnected={isAzureDevOpsConnected}
              isGoogleDriveConnected={isGoogleDriveConnected}
              googleDriveStatus={googleDriveStatus}
              onClose={() => {
                setSelectedIntegration(null);
                checkGmailConnection();
                checkGoogleDriveConnection();
              }}
            />
          )}
        </AnimatePresence>
      </main>
    </>
  );
};

const IntegrationDetail = ({
  integration,
  userIntegrations,
  companyIntegrations,
  isAdmin,
  isCalendarConnected,
  isAzureBlobConnected,
  
  isGmailConnected,
  isSlackConnected,
  slackWorkspaceName,
  isAzureDevOpsConnected,
  isGoogleDriveConnected,
  googleDriveStatus,
  onClose,
}: {
  integration: Integration;
  userIntegrations: UserIntegration[];
  companyIntegrations: CompanyIntegration[];
  isAdmin: boolean;
  isCalendarConnected: boolean | null;
  isAzureBlobConnected: boolean | null;
  
  isGmailConnected: boolean | null;
  isSlackConnected: boolean | null;
  slackWorkspaceName: string | null;
  isAzureDevOpsConnected: boolean | null;
  isGoogleDriveConnected: boolean | null;
  googleDriveStatus: GoogleDriveStatusDetail | null;
  onClose: () => void;
}) => {
  const isGoogleCalendar = integration.id === "google-calendar";
  const isAzureBlob = integration.id === "azure-blob";
  const isBasecamp = integration.id === "basecamp";
  const isGmail = integration.id === "gmail";
  const isAzureDevOps = integration.id === "azure-devops";
  const isGoogleDrive = integration.id === "google-drive";
  const isSlack = integration.id === "slack";
  const isHubSpot = integration.id === "hubspot";
  const isGitHub = integration.id === "github";
  const isRuntimeStatusIntegration = isHubSpot || isGitHub;
  const isGoogleOAuth = isGoogleCalendar;
  const isOAuthFlow = isGoogleOAuth || isBasecamp || isGmail || isSlack || isAzureDevOps || isGoogleDrive;
  
  // Determine status based on integration type
  let status: IntegrationStatus;
  if (isGoogleCalendar) {
    status = isCalendarConnected ? "connected" : "disconnected";
  } else if (isAzureBlob) {
    status = isAzureBlobConnected ? "connected" : "disconnected";
  } else if (isBasecamp) {
    status = isBasecampConnected ? "connected" : "disconnected";
  } else if (isGmail) {
    status = isGmailConnected ? "connected" : "disconnected";
  } else if (isSlack) {
    status = isSlackConnected ? "connected" : "disconnected";
  } else if (isAzureDevOps) {
    status = isAzureDevOpsConnected ? "connected" : "disconnected";
  } else if (isGoogleDrive) {
    status = isGoogleDriveConnected ? "connected" : "disconnected";
  } else {
    status = getStatus(integration, userIntegrations, companyIntegrations);
  }
  
  const integrationData = getIntegrationData(integration, userIntegrations, companyIntegrations);
  const [apiKey, setApiKey] = useState("");
  const [statusDetail, setStatusDetail] = useState<any | null>(null);
  const isCompany = integration.type === "company";
  const credentialLabel = isCompany
    ? "Company API Key / Token"
    : "API Key / Token";
  const credentialPlaceholder = `Enter your ${integration.name} API key...`;
  
  // User integration mutations
  const connectMutation = useConnectIntegration();
  const disconnectMutation = useDisconnectIntegration();
  
  // Company integration mutation
  const companyMutation = useUpdateCompanyIntegration();
  
  // Google OAuth hooks
  const { initiateOAuth: initiateCalendarOAuth, disconnect: disconnectCalendar, isLoading: calendarLoading } = useGoogleCalendar();
  const slackOAuth = useSlackConnection();
  const [basecampLoading, setBasecampLoading] = useState(false);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [azureDevOpsLoading, setAzureDevOpsLoading] = useState(false);
  const [googleDriveLoading, setGoogleDriveLoading] = useState(false);
  const [googleDriveTesting, setGoogleDriveTesting] = useState(false);
  const [localGoogleDriveStatus, setLocalGoogleDriveStatus] = useState<GoogleDriveStatusDetail | null>(googleDriveStatus);
  const [slackChannelId, setSlackChannelId] = useState("");
  const [slackMessage, setSlackMessage] = useState("");
  const [slackSending, setSlackSending] = useState(false);

  const fetchRuntimeStatus = async () => {
    if (!isRuntimeStatusIntegration) {
      setStatusDetail(null);
      return;
    }

    const fn = isHubSpot ? "hubspot-api" : "github-api";
    try {
      const data = await invokeEdge<any>(fn, { body: { action: "status" } });
      setStatusDetail(data);
    } catch (error) {
      setStatusDetail({
        status: "degraded",
        degraded_reason: error instanceof Error ? error.message : "Status check failed",
      });
    }
  };

  useEffect(() => {
    setLocalGoogleDriveStatus(googleDriveStatus);
  }, [googleDriveStatus]);

  useEffect(() => {
    let active = true;
    if (!isRuntimeStatusIntegration) {
      setStatusDetail(null);
      return () => {
        active = false;
      };
    }

    fetchRuntimeStatus().catch(() => undefined);

    return () => {
      active = false;
    };
  }, [isRuntimeStatusIntegration, isHubSpot, isGitHub, integration.id]);

  const resolvedStatus: IntegrationStatus = isRuntimeStatusIntegration && statusDetail
    ? statusDetail.status === "connected"
      ? "connected"
      : statusDetail.status === "degraded"
      ? "pending"
      : "disconnected"
    : status;
  const runtimeStatusLabel = getRuntimeStatusLabel(statusDetail);
  const s = statusConfig[resolvedStatus];

  const handleConnect = async () => {
    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
      toast.error(isSlack ? "Please enter a password" : "Please enter an API key");
      return;
    }
    try {
      if (isCompany) {
        await companyMutation.mutateAsync({ integrationId: integration.id, apiKey: trimmedApiKey });
        await fetchRuntimeStatus();
      } else {
        await connectMutation.mutateAsync({ integrationId: integration.id, apiKey: trimmedApiKey });
      }
      toast.success(`${integration.name} connected successfully!`);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to connect");
    }
  };

  const handleDisconnect = async () => {
    try {
      if (isGoogleCalendar) {
        await disconnectCalendar();
        toast.success("Google Calendar disconnected");
        onClose();
        return;
      }

      if (isSlack) {
        await slackOAuth.disconnect();
        onClose();
        return;
      }

      if (isGmail) {
        setGmailLoading(true);
        const { supabase } = await import("@/integrations/supabase/client");
        await withFastApi(
          async () => {
            const { error } = await supabase.functions.invoke("gmail-api", {
              body: { action: "disconnect" },
            });
            if (error) throw error;
            return null;
          },
          () => fastApi("POST", "/gmail/api", { action: "disconnect" }),
        );
        toast.success("Gmail disconnected");
        onClose();
        return;
      }

      if (isGoogleDrive) {
        setGoogleDriveLoading(true);
        const { supabase } = await import("@/integrations/supabase/client");
        await withFastApi(
          async () => {
            const { error } = await supabase.functions.invoke("google-drive-api", {
              body: { action: "disconnect" },
            });
            if (error) throw error;
            return null;
          },
          () => fastApi("POST", "/drive/api", { action: "disconnect" }),
        );
        toast.success("Google Drive disconnected");
        onClose();
        return;
      }

      if (isAzureDevOps) {
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase
          .from("azure_devops_tokens")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        if (error) throw error;
        await fetchRuntimeStatus();
        toast.success("Azure DevOps disconnected");
        onClose();
        return;
      }

      if (isCompany) {
        await companyMutation.mutateAsync({ integrationId: integration.id, action: "disconnect" });
        await fetchRuntimeStatus();
      } else {
        await disconnectMutation.mutateAsync(integration.id);
      }
      toast.success(`${integration.name} disconnected`);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to disconnect");
    } finally {
      setGmailLoading(false);
      setGoogleDriveLoading(false);
    }
  };

  const handleOAuthConnect = async () => {
    try {
      if (isGoogleCalendar) {
        await initiateCalendarOAuth();
      } else if (isBasecamp) {
        setBasecampLoading(true);
        const { supabase } = await import("@/integrations/supabase/client");
        const data = await withFastApi<{ url?: string }>(
          async () => {
            const { data, error } = await supabase.functions.invoke("basecamp-auth");
            if (error) throw error;
            return data;
          },
          () => fastApi("GET", "/basecamp/auth"),
        );
        if (data?.url) window.location.href = data.url;
        else throw new Error("No auth URL returned");
        setBasecampLoading(false);
      } else if (isGmail) {
        setGmailLoading(true);
        const { supabase } = await import("@/integrations/supabase/client");
        const data = await withFastApi<{ url?: string }>(
          async () => {
            const { data, error } = await supabase.functions.invoke("gmail-auth");
            if (error) throw error;
            return data;
          },
          () => fastApi("GET", "/gmail/auth"),
        );
        if (data?.url) window.location.href = data.url;
        else throw new Error("No auth URL returned");
        setGmailLoading(false);
      } else if (isSlack) {
        await slackOAuth.connect();
      } else if (isAzureDevOps) {
        setAzureDevOpsLoading(true);
        const { supabase } = await import("@/integrations/supabase/client");
        const data = await withFastApi<{ url?: string }>(
          async () => {
            const { data, error } = await supabase.functions.invoke("azure-devops-auth");
            if (error) throw error;
            return data;
          },
          () => fastApi("GET", "/azure-devops/auth"),
        );
        if (data?.url) window.location.href = data.url;
        else throw new Error("No auth URL returned");
        setAzureDevOpsLoading(false);
      } else if (isGoogleDrive) {
        setGoogleDriveLoading(true);
        const { supabase } = await import("@/integrations/supabase/client");
        const data = await withFastApi<{ url?: string }>(
          async () => {
            const { data, error } = await supabase.functions.invoke("google-drive-auth");
            if (error) throw error;
            return data;
          },
          () => fastApi("GET", "/drive/auth"),
        );
        if (data?.url) window.location.href = data.url;
        else throw new Error("No auth URL returned");
        setGoogleDriveLoading(false);
      }
    } catch (err: any) {
      setBasecampLoading(false);
      setGmailLoading(false);
      setAzureDevOpsLoading(false);
      setGoogleDriveLoading(false);
      setGoogleDriveLoading(false);
      toast.error(err.message || "Failed to start OAuth flow");
    }
  };

  const handleGoogleDriveTest = async () => {
    try {
      setGoogleDriveTesting(true);
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("google-drive-api", {
        body: { action: "test" },
      });
      if (error) throw error;
      setLocalGoogleDriveStatus(data as GoogleDriveStatusDetail);
      if (data?.status === "connected") {
        toast.success(`Google Drive verified${typeof data.visible_file_count === "number" ? ` · ${data.visible_file_count} files visible in test` : ""}`);
      } else {
        toast.error(data?.degraded_reason || data?.error || "Google Drive verification failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to test Google Drive");
    } finally {
      setGoogleDriveTesting(false);
    }
  };

  const handleSlackSendMessage = async () => {
    const channelId = slackChannelId.trim();
    const text = slackMessage.trim();
    if (!channelId || !text) {
      toast.error("Add a channel ID and message first");
      return;
    }

    try {
      setSlackSending(true);
      const { supabase } = await import("@/integrations/supabase/client");
      const { data, error } = await supabase.functions.invoke("slack-send-message", {
        body: { channel_id: channelId, text },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Message posted as you in ${channelId}`);
      setSlackMessage("");
    } catch (err: any) {
      toast.error(err.message || "Failed to send Slack message");
    } finally {
      setSlackSending(false);
    }
  };

  const oauthLoading = isGoogleCalendar ? calendarLoading : isBasecamp ? basecampLoading : isGmail ? gmailLoading : isSlack ? slackOAuth.isFetching : isAzureDevOps ? azureDevOpsLoading : googleDriveLoading;
  const isPending = isOAuthFlow ? oauthLoading : (isCompany ? companyMutation.isPending : (connectMutation.isPending || disconnectMutation.isPending));
  const canEdit = !isCompany || isAdmin;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed right-0 top-0 z-50 h-screen w-full max-w-lg border-l border-border bg-card overflow-y-auto"
      >
        <div className="px-6 py-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
                <integration.icon className="h-6 w-6 text-secondary-foreground" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-foreground">{integration.name}</h2>
                  {isCompany && (
                    <span className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      <Lock className="h-3 w-3" />
                      Company
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed mb-6">{integration.description}</p>

          {/* Services */}
          <div className="mb-6">
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Services Included</h3>
            <div className="grid grid-cols-2 gap-2">
              {integration.services.map((service) => (
                <div key={service} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium text-foreground">{service}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Setup Steps */}
          <div className="mb-6">
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Setup Guide</h3>
            <div className="space-y-3">
              {integration.setupSteps.map((step, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-[10px] font-bold text-muted-foreground">
                    {i + 1}
                  </div>
                  <p className="text-sm text-foreground/80 leading-relaxed pt-0.5">{step}</p>
                </div>
              ))}
            </div>
          </div>

          {/* What Norman Gets */}
          <div className="mb-8">
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">What Duncan Gets</h3>
            <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Database className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-foreground">Full content indexing for reasoning</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-norman-warning" />
                <span className="text-xs text-foreground">Real-time sync for automation triggers</span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-norman-success" />
                <span className="text-xs text-foreground">Scoped access — only what you share</span>
              </div>
            </div>
          </div>

          {/* Admin notice for company integrations */}
          {isCompany && !isAdmin && (
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
              <Lock className="h-4 w-4 text-primary" />
              <span className="text-sm text-primary">Only admins can configure company integrations</span>
            </div>
          )}

          {/* Action */}
          {resolvedStatus === "disconnected" ? (
            canEdit ? (
              isRuntimeStatusIntegration ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-2">
                    <p className="text-sm text-foreground">Use a workspace connector if available, or paste a company token below for the fastest path.</p>
                    <p className="text-xs text-muted-foreground">Team Briefing keeps generating even while this remains disconnected, but it will explicitly flag the blind spot.</p>
                    {runtimeStatusLabel || statusDetail?.degraded_reason ? (
                      <p className="text-xs text-muted-foreground">
                        Current status: {runtimeStatusLabel || statusDetail?.degraded_reason}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="api-key" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                      {credentialLabel}
                    </Label>
                    <Input
                      id="api-key"
                      type="password"
                      placeholder={credentialPlaceholder}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="bg-secondary/30 border-border"
                    />
                  </div>
                  <button
                    onClick={handleConnect}
                    disabled={isPending}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <Plug className="h-4 w-4" />
                        Connect {integration.name}
                      </>
                    )}
                  </button>
                </div>
              ) : isOAuthFlow ? (
                // OAuth flow
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-2">
                    <p className="text-sm text-foreground">
                      {isAzureDevOps
                        ? "Click below to authorize Duncan to access your Azure DevOps work items and boards."
                        : isBasecamp 
                        ? "Click below to authorize Duncan to access your Basecamp projects, to-dos, and messages."
                        : isGmail
                        ? "Click below to sign in with Google and grant Duncan read-only access to your Gmail for CV ingestion."
                        : isSlack
                        ? "Click below to authorize Duncan to connect your Slack workspace."
                        : isGoogleDrive
                        ? "Click below to sign in with Google and grant Duncan read-only access to the shared Google Drive workspace."
                        : "Click below to sign in with Google and grant Duncan access to your calendar."}
                    </p>
                  </div>
                  <button
                    onClick={handleOAuthConnect}
                    disabled={isPending}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <ExternalLink className="h-4 w-4" />
                        {isAzureDevOps ? "Connect Azure DevOps" : isBasecamp ? "Connect with Basecamp" : isGmail ? "Connect Gmail" : isSlack ? "Connect Slack" : isGoogleDrive ? "Connect Google Drive" : "Sign in with Google"}
                      </>
                    )}
                  </button>
                </div>
              ) : (
                // Standard API key flow
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="api-key" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                      {credentialLabel}
                    </Label>
                    <Input
                      id="api-key"
                      type="password"
                      placeholder={credentialPlaceholder}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="bg-secondary/30 border-border"
                    />
                  </div>
                  <button
                    onClick={handleConnect}
                    disabled={isPending}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <Plug className="h-4 w-4" />
                        Connect {integration.name}
                      </>
                    )}
                  </button>
                </div>
              )
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-muted bg-muted/30 px-4 py-3">
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Contact an admin to connect this integration</span>
              </div>
            )
          ) : resolvedStatus === "connected" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-norman-success/20 bg-norman-success/5 px-4 py-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-norman-success" />
                  <span className="text-sm font-medium text-norman-success">
                    {isSlack
                      ? `Slack connected${slackWorkspaceName ? ` · ${slackWorkspaceName}` : ""}`
                      : isGoogleDrive
                      ? `Google Drive connected${localGoogleDriveStatus?.account_email ? ` · ${localGoogleDriveStatus.account_email}` : ""}`
                      : "Connected & syncing"}
                  </span>
                </div>
                {(localGoogleDriveStatus?.last_verified_at || statusDetail?.last_verified_at || integrationData?.last_sync) && (
                  <span className="text-[10px] font-mono text-muted-foreground">{new Date(localGoogleDriveStatus?.last_verified_at || statusDetail?.last_verified_at || integrationData?.last_sync).toLocaleDateString()}</span>
                )}
              </div>
              {isGoogleDrive && (
                <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                  <div>
                    <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Drive verification</div>
                    <p className="mt-1 text-sm text-foreground/80">
                      {localGoogleDriveStatus?.account_name || localGoogleDriveStatus?.account_email || "Shared Google Drive token verified."}
                    </p>
                    {localGoogleDriveStatus?.token_expiry ? (
                      <p className="mt-1 text-xs text-muted-foreground">Token expiry: {new Date(localGoogleDriveStatus.token_expiry).toLocaleString()}</p>
                    ) : null}
                    {localGoogleDriveStatus?.visible_file_count !== undefined ? (
                      <p className="mt-1 text-xs text-muted-foreground">Latest test saw {localGoogleDriveStatus.visible_file_count} Drive item{localGoogleDriveStatus.visible_file_count === 1 ? "" : "s"}.</p>
                    ) : null}
                  </div>
                  {localGoogleDriveStatus?.sample_files?.length ? (
                    <div className="space-y-1">
                      {localGoogleDriveStatus.sample_files.map((file) => (
                        <div key={file.id} className="truncate rounded-md bg-background px-2 py-1 text-xs text-muted-foreground">
                          {file.name}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {localGoogleDriveStatus?.degraded_reason || localGoogleDriveStatus?.error ? (
                    <p className="text-xs text-destructive">{localGoogleDriveStatus.degraded_reason || localGoogleDriveStatus.error}</p>
                  ) : null}
                  <button
                    onClick={handleGoogleDriveTest}
                    disabled={googleDriveTesting}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-secondary transition-all disabled:opacity-50"
                  >
                    {googleDriveTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {googleDriveTesting ? "Testing Drive..." : "Test connection"}
                  </button>
                </div>
              )}
              {(isRuntimeStatusIntegration || isSlack) && (
                <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-2">
                  <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{isSlack ? "Workspace" : "Used by Team Briefing"}</div>
                  <p className="text-sm text-foreground/80">
                    {isSlack
                      ? slackWorkspaceName || "Slack workspace connected."
                      : runtimeStatusLabel || statusDetail?.degraded_reason || "This integration is available to the Team Briefing pipeline."}
                  </p>
                  {!isSlack && statusDetail?.verification_path ? (
                    <p className="text-xs text-muted-foreground">Verification path: {statusDetail.verification_path}</p>
                  ) : null}
                </div>
              )}
              {isSlack && (
                <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                  <div>
                    <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Send to Slack</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Posts with your Slack identity after reconnecting with user permissions.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slack-channel-id" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Channel ID</Label>
                    <Input
                      id="slack-channel-id"
                      placeholder="C0123456789"
                      value={slackChannelId}
                      onChange={(e) => setSlackChannelId(e.target.value)}
                      className="bg-background border-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slack-message" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Message</Label>
                    <Textarea
                      id="slack-message"
                      placeholder="Type a message..."
                      value={slackMessage}
                      onChange={(e) => setSlackMessage(e.target.value)}
                      className="bg-background border-border"
                    />
                  </div>
                  <button
                    onClick={handleSlackSendMessage}
                    disabled={slackSending || !slackMessage.trim() || !slackChannelId.trim()}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {slackSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                    {slackSending ? "Sending..." : "Send as me"}
                  </button>
                </div>
              )}
              {isBasecamp && (
                <div className="mt-4">
                  <BasecampBrowser />
                </div>
              )}
              {canEdit && (
                <button
                  onClick={handleDisconnect}
                  disabled={isPending}
                  className="w-full rounded-xl border border-destructive/20 text-destructive py-2.5 text-sm font-medium hover:bg-destructive/5 transition-all disabled:opacity-50"
                >
                  {isPending ? "Disconnecting..." : "Disconnect"}
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-xl border border-norman-warning/20 bg-norman-warning/5 px-4 py-3">
                <AlertCircle className="h-4 w-4 text-norman-warning" />
                <span className="text-sm text-norman-warning">{runtimeStatusLabel || "Connected with reduced visibility"}</span>
              </div>
              {statusDetail?.degraded_reason || statusDetail?.verification_path ? (
                <div className="rounded-lg border border-border bg-secondary/20 p-4 text-sm text-foreground/80">
                  <div>{statusDetail?.degraded_reason}</div>
                  {statusDetail?.verification_path ? (
                    <div className="mt-1 text-xs text-muted-foreground">Verification path: {statusDetail.verification_path}</div>
                  ) : null}
                </div>
              ) : null}
              {canEdit && isRuntimeStatusIntegration ? (
                <div className="space-y-2">
                  <Label htmlFor="retry-api-key" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    Replace token
                  </Label>
                  <Input
                    id="retry-api-key"
                    type="password"
                    placeholder={credentialPlaceholder}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="bg-secondary/30 border-border"
                  />
                  <button
                    onClick={handleConnect}
                    disabled={isPending}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {isPending ? "Retrying..." : `Retry ${integration.name} verification`}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
};

export default Integrations;
