/**
 * Strip markdown / table / emoji noise so ElevenLabs reads natural prose.
 * Mirrors the server-side sanitiser in supabase/functions/elevenlabs-tts.
 */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|\*|_)/g, "")
    .replace(/\|/g, " ")
    .replace(/^[\s-]*[-:]{2,}[\s-:]*$/gm, " ")
    .replace(/^[\s>]*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull complete sentences out of a buffer, returning [sentences, remainder].
 * Splits on . ! ? and double newlines, but keeps abbreviations intact by
 * requiring a trailing space or end-of-buffer.
 */
export function extractSentences(buffer: string): {
  sentences: string[];
  remainder: string;
} {
  const sentences: string[] = [];
  let remainder = buffer;

  // Greedy: pull off chunks ending in . ! ? followed by whitespace or end.
  const re = /([^.!?\n]+[.!?]+)(\s+|$)/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = re.exec(buffer)) !== null) {
    const sentence = match[1].trim();
    if (sentence.length > 0) sentences.push(sentence);
    lastIndex = re.lastIndex;
  }
  remainder = buffer.slice(lastIndex);

  // Also flush on double newline
  if (remainder.includes("\n\n")) {
    const parts = remainder.split(/\n\n+/);
    const flushable = parts.slice(0, -1).map((p) => p.trim()).filter(Boolean);
    sentences.push(...flushable);
    remainder = parts[parts.length - 1];
  }

  return { sentences, remainder };
}

/**
 * Eager variant: in addition to full sentence boundaries (. ! ?), also
 * accepts soft phrase boundaries (, ; : —) once the unspoken buffer is
 * long enough. Used during streaming so TTS can start sooner.
 */
export function extractSpeakable(
  buffer: string,
  opts: { eager?: boolean; minSoftLen?: number } = {}
): { sentences: string[]; remainder: string } {
  const { sentences, remainder } = extractSentences(buffer);
  if (!opts.eager) return { sentences, remainder };

  const minLen = opts.minSoftLen ?? 60;
  if (remainder.length < minLen) return { sentences, remainder };

  // Find last soft boundary followed by whitespace within remainder.
  const softRe = /[,;:—–](\s+)/g;
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = softRe.exec(remainder)) !== null) {
    lastEnd = m.index + 1; // include the punctuation char
  }
  if (lastEnd < minLen) return { sentences, remainder };

  const head = remainder.slice(0, lastEnd).trim();
  const tail = remainder.slice(lastEnd).replace(/^\s+/, "");
  if (head.length > 0) sentences.push(head);
  return { sentences, remainder: tail };
}

