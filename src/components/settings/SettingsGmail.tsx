import { useEffect, useState } from "react";
import { Mail, Loader2, Sparkles, Trash2, RefreshCw, CheckCircle2, Wand2, Eye, X, Plus } from "lucide-react";
import {
  useGmailWritingProfile,
  useGmailTrainStyle,
  useGmailDeleteWritingProfile,
  useGmailStatus,
  useGmailAutoDraftToggle,
  useGmailCEOBriefingOptinToggle,
  useGmailAutoDraftFilterUpdate,
} from "@/hooks/useGmailIntegration";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { formatDistanceToNow } from "date-fns";

export default function SettingsGmail({ embedded = false }: { embedded?: boolean }) {
  const { data: status } = useGmailStatus();
  const { data: profile, isLoading } = useGmailWritingProfile();
  const trainMutation = useGmailTrainStyle();
  const deleteMutation = useGmailDeleteWritingProfile();
  const autoDraftToggle = useGmailAutoDraftToggle();
  const ceoOptinToggle = useGmailCEOBriefingOptinToggle();

  const filterUpdate = useGmailAutoDraftFilterUpdate();

  const trained = profile?.last_trained_at;
  const autoDraftEnabled = profile?.auto_draft_enabled ?? false;
  const ceoOptinEnabled = profile?.ceo_briefing_optin ?? false;
  const lastRun = profile?.auto_draft_last_run_at;
  const today = new Date().toISOString().slice(0, 10);
  const draftsToday = profile?.auto_drafts_counter_date === today
    ? profile?.auto_drafts_created_today ?? 0
    : 0;

  const [filterMode, setFilterMode] = useState<"blacklist" | "whitelist">(
    profile?.auto_draft_filter_mode ?? "blacklist",
  );
  const [filterList, setFilterList] = useState<string[]>(profile?.auto_draft_filter_list ?? []);
  const [filterInput, setFilterInput] = useState("");

  useEffect(() => {
    if (profile) {
      setFilterMode(profile.auto_draft_filter_mode ?? "blacklist");
      setFilterList(profile.auto_draft_filter_list ?? []);
    }
  }, [profile?.auto_draft_filter_mode, profile?.auto_draft_filter_list?.join(",")]);

  const addFilterEntry = () => {
    const v = filterInput.trim().toLowerCase();
    if (!v) return;
    if (filterList.includes(v)) { setFilterInput(""); return; }
    const next = [...filterList, v];
    setFilterList(next);
    setFilterInput("");
    filterUpdate.mutate({ mode: filterMode, list: next });
  };
  const removeFilterEntry = (entry: string) => {
    const next = filterList.filter((e) => e !== entry);
    setFilterList(next);
    filterUpdate.mutate({ mode: filterMode, list: next });
  };
  const changeMode = (mode: "blacklist" | "whitelist") => {
    setFilterMode(mode);
    filterUpdate.mutate({ mode, list: filterList });
  };

  if (!status?.connected) {
    return (
      <div className={embedded ? "" : "px-6 py-8"}>
        <div className="flex items-start gap-3">
          <Mail className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Gmail not connected</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Connect your Gmail from the Integrations page to enable Duncan's writing-style learning.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "space-y-6" : "px-6 py-6 space-y-6"}>
      <div>
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Writing-style training
        </h3>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
          Duncan analyses your last 300 sent emails to learn your tone, vocabulary, and structure —
          so drafts sound like you. Content is processed once, redacted of personal details, and only the
          derived style profile is stored.
        </p>
      </div>

      {/* Status card */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading profile...
          </div>
        ) : trained ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-norman-success" />
              <span className="text-xs font-medium text-foreground">Profile active</span>
            </div>
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              <div>Trained on {profile?.sample_count ?? 0} emails</div>
              <div>Last updated {formatDistanceToNow(new Date(trained), { addSuffix: true })}</div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            No profile yet. Run training to teach Duncan how you write.
          </div>
        )}
      </div>

      {/* Sample preview */}
      {profile?.style_summary && (
        <details className="rounded-xl border border-border bg-card/50 p-4 group">
          <summary className="text-xs font-medium text-foreground cursor-pointer list-none flex items-center justify-between">
            <span>View learned style summary</span>
            <span className="text-[10px] text-muted-foreground group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed whitespace-pre-wrap">
            {profile.style_summary}
          </p>
        </details>
      )}

      {/* Training actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => trainMutation.mutate(300)}
          disabled={trainMutation.isPending}
          className="flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
        >
          {trainMutation.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Training... (~2 min)
            </>
          ) : (
            <>
              {trained ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              {trained ? "Re-train Duncan" : "Train Duncan on my writing"}
            </>
          )}
        </button>

        {trained && (
          <button
            onClick={() => {
              if (confirm("Delete your writing profile? Duncan will fall back to generic email rules.")) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="flex items-center gap-2 rounded-lg border border-border text-muted-foreground px-4 py-2 text-xs font-medium hover:text-destructive hover:border-destructive/50 transition-all disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete profile
          </button>
        )}
      </div>

      {/* Auto-draft section */}
      <div className="border-t border-border pt-6">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            Auto-draft replies
          </h3>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            Duncan checks your inbox every 10 minutes and pre-drafts replies to new emails using your
            writing style. Drafts go straight to your Gmail Drafts folder — nothing is ever sent automatically.
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-card/50 p-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-xs font-medium text-foreground">
                Auto-draft replies for new emails
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                {trained
                  ? "Skips noreply senders, calendar invites, list emails, and short notifications. Capped at 100 drafts per day."
                  : "You can enable this now — Duncan will start drafting once you've trained your writing style above."}
              </p>
            </div>
            <Switch
              checked={autoDraftEnabled}
              disabled={autoDraftToggle.isPending}
              onCheckedChange={(v) => autoDraftToggle.mutate(v)}
            />
          </div>

          {autoDraftEnabled && (
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last run</div>
                <div className="text-xs text-foreground mt-0.5">
                  {lastRun ? formatDistanceToNow(new Date(lastRun), { addSuffix: true }) : "Not yet"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Drafts today</div>
                <div className="text-xs text-foreground mt-0.5">{draftsToday} / 100</div>
              </div>
            </div>
          )}

          {autoDraftEnabled && (
            <div className="pt-3 border-t border-border space-y-3">
              <div>
                <div className="text-xs font-medium text-foreground">Sender filter</div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                  {filterMode === "blacklist"
                    ? "Duncan will skip emails from these senders. Use a full email (jane@acme.com) or a domain (@acme.com)."
                    : "Duncan will only draft replies for emails from these senders. Empty list = no one."}
                </p>
              </div>

              <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 text-[11px]">
                <button
                  onClick={() => changeMode("blacklist")}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    filterMode === "blacklist" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  Blacklist
                </button>
                <button
                  onClick={() => changeMode("whitelist")}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    filterMode === "whitelist" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  Whitelist
                </button>
              </div>

              <div className="flex gap-2">
                <Input
                  value={filterInput}
                  onChange={(e) => setFilterInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFilterEntry(); } }}
                  placeholder="email@example.com or @example.com"
                  className="h-8 text-xs"
                />
                <button
                  onClick={addFilterEntry}
                  disabled={!filterInput.trim() || filterUpdate.isPending}
                  className="flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              </div>

              {filterList.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {filterList.map((entry) => (
                    <span
                      key={entry}
                      className="inline-flex items-center gap-1 rounded-md bg-secondary/60 px-2 py-1 text-[11px] text-foreground"
                    >
                      {entry}
                      <button
                        onClick={() => removeFilterEntry(entry)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${entry}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/70 italic">
                  {filterMode === "whitelist"
                    ? "No senders added — auto-draft is effectively off until you add some."
                    : "No senders blocked yet."}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Team Briefing inbox opt-in */}
      <div className="border-t border-border pt-6">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            Include my inbox in the Team Briefing
          </h3>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            When enabled, Duncan scans the last 24h of your inbox for commitments, risks, escalations,
            board mentions, and customer/vendor signals — and feeds them into the Team Briefing. Raw
            email content is never stored; only the structured signals are persisted on each briefing.
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-card/50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-xs font-medium text-foreground">
                Allow Duncan to include signals from my inbox
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                Off by default. Only the CEO sees the briefing. Turn off any time.
              </p>
            </div>
            <Switch
              checked={ceoOptinEnabled}
              disabled={ceoOptinToggle.isPending}
              onCheckedChange={(v) => ceoOptinToggle.mutate(v)}
            />
          </div>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
        Privacy: Email content is sent to OpenAI for one-time analysis only. Personal details (emails,
        phone numbers) are redacted before processing. Only the derived style profile is stored.
        Auto-drafted replies are prefixed with "[Auto-drafted by Duncan]" so you always know which
        drafts are AI-generated.
      </p>
    </div>
  );
}
