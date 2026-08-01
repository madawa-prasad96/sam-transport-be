/**
 * Strips quoted history and signature blocks from an email reply.
 *
 * This is heuristic by nature — there is no standard for how clients quote —
 * so it errs towards keeping content: a reply with some quoted text left in is
 * far less damaging than one with the actual message cut off.
 */

const QUOTE_MARKERS: RegExp[] = [
  // "On Mon, 1 Jan 2026 at 09:00, Someone <a@b.com> wrote:"
  /^\s*On .+ (wrote|schrieb|escribió):\s*$/i,
  // Outlook / Gmail block headers
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^\s*_{5,}\s*$/,
  /^\s*From:\s.+$/i,
  /^\s*Sent:\s.+$/i,
  /^\s*>{1,}\s?From:\s.+$/i,
  // Our own footer — never quote it back into a comment
  /^\s*Reply to this email to add a comment/i,
];

const SIGNATURE_MARKERS: RegExp[] = [
  /^--\s*$/,
  /^\s*Sent from my (iPhone|iPad|Android|Samsung|Galaxy).*$/i,
  /^\s*Get Outlook for (iOS|Android)\s*$/i,
];

export interface ParsedReply {
  text: string;
  strippedSomething: boolean;
}

export const stripQuotedText = (raw: string): ParsedReply => {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  let cutAt = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (QUOTE_MARKERS.some((marker) => marker.test(line))) {
      cutAt = i;
      break;
    }

    // A run of three or more consecutive ">" lines is quoted history, not a
    // single quoted sentence someone deliberately included.
    if (/^\s*>/.test(line)) {
      let run = 0;
      let j = i;
      while (j < lines.length && (/^\s*>/.test(lines[j]) || lines[j].trim() === '')) {
        if (/^\s*>/.test(lines[j])) run += 1;
        j += 1;
      }
      if (run >= 3) {
        cutAt = i;
        break;
      }
    }
  }

  let kept = lines.slice(0, cutAt);

  // Trim a trailing signature block.
  for (let i = kept.length - 1; i >= 0 && i > kept.length - 12; i -= 1) {
    if (SIGNATURE_MARKERS.some((marker) => marker.test(kept[i]))) {
      kept = kept.slice(0, i);
      break;
    }
  }

  const text = kept.join('\n').trim();

  return {
    // If stripping ate everything, the heuristic was wrong — keep the original.
    text: text.length > 0 ? text : raw.trim(),
    strippedSomething: cutAt < lines.length,
  };
};

/** Extracts a bare address from "Name <a@b.com>" or "a@b.com". */
export const extractAddress = (value: string): string => {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1] : value).trim().toLowerCase();
};

/** True when the message looks like an autoresponder — never post those. */
export const isAutoReply = (headers: Record<string, string | undefined>): boolean => {
  const get = (name: string) =>
    headers[name] ?? headers[name.toLowerCase()] ?? '';

  const autoSubmitted = get('Auto-Submitted').toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  if (get('X-Autoreply')) return true;
  if (get('X-Autorespond')) return true;

  const precedence = get('Precedence').toLowerCase();
  if (['bulk', 'auto_reply', 'junk', 'list'].includes(precedence)) return true;

  return false;
};
