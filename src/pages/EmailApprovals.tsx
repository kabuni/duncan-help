import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Mail, Clock, Undo2, Edit3, Check, Trash2, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  usePendingApprovals, useQueuedOutbox, useSenderTrust,
  useDecideApproval, useUndoOutbox, useToggleSenderTrust,
  type EmailApproval,
} from "@/hooks/useEmailApprovals";

function ApprovalCard({ a }: { a: EmailApproval }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.proposed_reply);
  const decide = useDecideApproval();

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            {a.sender_name || a.sender_email} <span className="text-muted-foreground font-normal">· {a.sender_email}</span>
          </div>
          <div className="text-sm text-muted-foreground truncate">{a.subject || "(no subject)"}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {typeof a.ai_confidence === "number" && (
            <Badge variant="secondary">{Math.round(a.ai_confidence * 100)}%</Badge>
          )}
          {(a.risk_flags || []).map((f) => (
            <Badge key={f} variant="outline" className="text-amber-600 border-amber-500/50">{f}</Badge>
          ))}
        </div>
      </div>

      {a.incoming_summary && (
        <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2 whitespace-pre-wrap">
          {a.incoming_summary}
        </div>
      )}

      {editing ? (
        <Textarea rows={10} value={draft} onChange={(e) => setDraft(e.target.value)} className="text-sm font-mono" />
      ) : (
        <pre className="text-sm whitespace-pre-wrap font-sans bg-background border rounded p-3">
          {a.proposed_reply}
        </pre>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!editing ? (
          <>
            <Button size="sm" onClick={() => decide.mutate({ approval_id: a.id, action: "approve" })}>
              <Check className="w-4 h-4 mr-1" /> Send as-is
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Edit3 className="w-4 h-4 mr-1" /> Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => decide.mutate({ approval_id: a.id, action: "discard" })}>
              <Trash2 className="w-4 h-4 mr-1" /> Discard
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => decide.mutate({ approval_id: a.id, action: "edit", edited_body: draft })}>
              <Check className="w-4 h-4 mr-1" /> Send edited
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(a.proposed_reply); }}>
              Cancel
            </Button>
          </>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
        </span>
      </div>
    </Card>
  );
}

function OutboxItem({ id, sender_email, subject, send_after }: any) {
  const undo = useUndoOutbox();
  const seconds = Math.max(0, Math.round((new Date(send_after).getTime() - Date.now()) / 1000));
  return (
    <Card className="p-3 flex items-center gap-3">
      <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{subject || "(no subject)"}</div>
        <div className="text-xs text-muted-foreground truncate">to {sender_email}</div>
      </div>
      <Badge variant="secondary" className="whitespace-nowrap">
        <Clock className="w-3 h-3 mr-1" /> sends in {seconds}s
      </Badge>
      <Button size="sm" variant="outline" onClick={() => undo.mutate(id)}>
        <Undo2 className="w-4 h-4 mr-1" /> Undo
      </Button>
    </Card>
  );
}

function TrustRow({ t }: { t: any }) {
  const toggle = useToggleSenderTrust();
  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{t.sender_email}</div>
        <div className="text-xs text-muted-foreground">
          {t.sends_approved} sent · {t.sends_edited} edited · {t.sends_rejected} rejected
        </div>
      </div>
      <Badge variant={t.confidence >= 0.9 ? "default" : "secondary"}>
        {Math.round((t.confidence || 0) * 100)}%
      </Badge>
      <Button
        size="sm"
        variant={t.force_trust ? "default" : "outline"}
        onClick={() => toggle.mutate({ id: t.id, force_trust: !t.force_trust, force_review: false })}
      >
        <ShieldCheck className="w-4 h-4 mr-1" /> Trust
      </Button>
      <Button
        size="sm"
        variant={t.force_review ? "default" : "outline"}
        onClick={() => toggle.mutate({ id: t.id, force_review: !t.force_review, force_trust: false })}
      >
        <ShieldAlert className="w-4 h-4 mr-1" /> Always review
      </Button>
    </div>
  );
}

export default function EmailApprovalsPage() {
  const { data: approvals = [], isLoading: la } = usePendingApprovals();
  const { data: outbox = [], isLoading: lo } = useQueuedOutbox();
  const { data: trust = [], isLoading: lt } = useSenderTrust();

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Email approvals</h1>
        <p className="text-sm text-muted-foreground">
          Review Duncan's drafts when he's not certain, undo auto-sends within the 5-minute window,
          and manage which senders he trusts.
        </p>
      </header>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending ({approvals.length})</TabsTrigger>
          <TabsTrigger value="outbox">Auto-send outbox ({outbox.length})</TabsTrigger>
          <TabsTrigger value="trust">Trusted senders ({trust.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3 mt-4">
          {la ? <div className="text-sm text-muted-foreground">Loading…</div>
            : approvals.length === 0
            ? <div className="text-sm text-muted-foreground">Nothing waiting on you. Duncan will queue drafts here when he's not confident enough to auto-send.</div>
            : approvals.map((a) => <ApprovalCard key={a.id} a={a} />)}
        </TabsContent>

        <TabsContent value="outbox" className="space-y-2 mt-4">
          {lo ? <div className="text-sm text-muted-foreground">Loading…</div>
            : outbox.length === 0
            ? <div className="text-sm text-muted-foreground">No emails currently in the undo window.</div>
            : outbox.map((o) => <OutboxItem key={o.id} {...o} />)}
        </TabsContent>

        <TabsContent value="trust" className="mt-4">
          <Card className="p-4">
            {lt ? <div className="text-sm text-muted-foreground">Loading…</div>
              : trust.length === 0
              ? <div className="text-sm text-muted-foreground">No senders scored yet. As Duncan drafts replies, confidence builds here.</div>
              : trust.map((t) => <TrustRow key={t.id} t={t} />)}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
