import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import DOMPurify from "dompurify";
import { ArrowLeft, Loader2, User, Clock, Sparkles } from "lucide-react";
import { useGmailReadEmail, useGmailCreateDraft, type GmailFullEmail } from "@/hooks/useGmailIntegration";
import { format } from "date-fns";

interface GmailReaderProps {
  messageId: string;
  onBack: () => void;
}

const GmailReader = ({ messageId, onBack }: GmailReaderProps) => {
  const readMutation = useGmailReadEmail();
  const draftMutation = useGmailCreateDraft();
  const [email, setEmail] = useState<GmailFullEmail | null>(null);

  const handleDraftReply = () => {
    if (!email) return;
    const fromAddr = (email.from.match(/<([^>]+)>/)?.[1]) || email.from;
    const subject = email.subject?.startsWith("Re:") ? email.subject : `Re: ${email.subject || ""}`;
    draftMutation.mutate({
      to: fromAddr,
      subject,
      body: "",
      threadId: email.threadId,
    });
  };

  useEffect(() => {
    readMutation.mutate(messageId, {
      onSuccess: (data) => setEmail(data as GmailFullEmail),
    });
  }, [messageId]);

  if (readMutation.isPending) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!email) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Failed to load email</p>
        <button onClick={onBack} className="text-primary text-xs mt-2 hover:underline">Go back</button>
      </div>
    );
  }

  const formattedDate = (() => {
    try {
      return format(new Date(email.date), "MMM d, yyyy 'at' h:mm a");
    } catch {
      return email.date;
    }
  })();

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex flex-col h-full"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground leading-snug flex-1">
            {email.subject || "(no subject)"}
          </h2>
          <button
            onClick={handleDraftReply}
            disabled={draftMutation.isPending}
            className="shrink-0 flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {draftMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Draft reply with Duncan
          </button>
        </div>
        <div className="flex items-center gap-4 mt-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
              <User className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs font-medium text-foreground">{email.from}</p>
              <p className="text-[10px] text-muted-foreground">To: {email.to}</p>
              {email.cc && <p className="text-[10px] text-muted-foreground">Cc: {email.cc}</p>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formattedDate}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {email.htmlBody ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-foreground/90"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.htmlBody, { FORBID_TAGS: ["script", "style", "iframe", "object", "embed"], FORBID_ATTR: ["onerror", "onload", "onclick"] }) }}
          />
        ) : (
          <pre className="whitespace-pre-wrap text-sm text-foreground/90 font-sans leading-relaxed">
            {email.textBody || "No content"}
          </pre>
        )}
      </div>
    </motion.div>
  );
};

export default GmailReader;
