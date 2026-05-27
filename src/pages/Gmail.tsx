import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, PenSquare, Inbox, Loader2, ExternalLink, AlertTriangle, CheckCircle2, Unplug } from "lucide-react";
import GmailInbox from "@/components/gmail/GmailInbox";
import GmailReader from "@/components/gmail/GmailReader";
import GmailCompose from "@/components/gmail/GmailCompose";
import { useGmailStatus, useGmailConnect, useGmailDisconnect } from "@/hooks/useGmailIntegration";

type Tab = "inbox" | "compose";

const Gmail = () => {
  const { data: status, isLoading: statusLoading } = useGmailStatus();
  const { connect, loading: connectLoading } = useGmailConnect();
  const disconnectMutation = useGmailDisconnect();
  const [tab, setTab] = useState<Tab>("inbox");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);

  // Not connected state
  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!status?.connected) {
    return (
      <div className="flex items-center justify-center h-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md text-center px-8"
        >
            <div className="h-16 w-16 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-6">
              <Mail className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Connect Gmail</h2>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Connect your Gmail account to read, search, and send emails directly from Duncan.
              Your credentials are stored securely and never exposed to the frontend.
            </p>
            <button
              onClick={connect}
              disabled={connectLoading}
              className="flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-8 py-3 text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50 mx-auto"
            >
              {connectLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4" />
                  Sign in with Google
                </>
              )}
            </button>
            <p className="text-[10px] text-muted-foreground/60 mt-4">
              Only read and send permissions are requested. Duncan never stores email content.
            </p>
        </motion.div>
      </div>
    );
  }

  // Token expired state
  if (status.expired) {
    return (
      <div className="flex items-center justify-center h-full">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-md text-center px-8"
        >
            <div className="h-16 w-16 rounded-2xl bg-norman-warning/10 flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="h-8 w-8 text-norman-warning" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Session Expired</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Your Gmail session has expired. Please reconnect to continue.
            </p>
            <button
              onClick={connect}
              disabled={connectLoading}
              className="flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-8 py-3 text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50 mx-auto"
            >
              Reconnect Gmail
            </button>
        </motion.div>
      </div>
    );
  }

  return (
    <main className="flex flex-col h-full overflow-hidden">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-6 py-3 border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              <h1 className="text-sm font-bold text-foreground">Gmail</h1>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 min-w-0">
              <CheckCircle2 className="h-3 w-3 text-norman-success shrink-0" />
              <span className="text-[11px] text-muted-foreground truncate">{status.email}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Tabs */}
            <div className="flex items-center bg-secondary/50 rounded-lg p-0.5">
              <button
                onClick={() => { setTab("inbox"); setSelectedEmailId(null); }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  tab === "inbox" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Inbox className="h-3.5 w-3.5" />
                Inbox
              </button>
              <button
                onClick={() => { setTab("compose"); setSelectedEmailId(null); }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  tab === "compose" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <PenSquare className="h-3.5 w-3.5" />
                Compose
              </button>
            </div>
            <button
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
              title="Disconnect Gmail"
            >
              <Unplug className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {tab === "compose" ? (
            <div className="flex-1">
              <GmailCompose onSent={() => setTab("inbox")} />
            </div>
          ) : (
            <>
              {/* Inbox list */}
              <div className={`${selectedEmailId ? "hidden sm:block sm:w-80 lg:w-96" : "w-full"} border-r border-border`}>
                <GmailInbox
                  onSelectEmail={setSelectedEmailId}
                  selectedId={selectedEmailId || undefined}
                />
              </div>
              {/* Reader */}
              {selectedEmailId ? (
                <div className="flex-1">
                  <GmailReader
                    messageId={selectedEmailId}
                    onBack={() => setSelectedEmailId(null)}
                  />
                </div>
              ) : (
                <div className="hidden sm:flex flex-1 items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Select an email to read</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
  </main>
  );
};

export default Gmail;
