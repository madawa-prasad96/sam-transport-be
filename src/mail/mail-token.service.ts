import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hmac, safeEqual } from '../common/utils/tokens';

/**
 * Builds and verifies the tokenised reply address for an inquiry thread:
 *   inq+{inquiryId}.{token}@mail.domain
 *
 * The token is an HMAC over the inquiry id, so the address is self-verifying —
 * no lookup table, and it can't be forged by guessing an inquiry id.
 *
 * The address identifies the *inquiry*, not the individual recipient. The
 * sender is then resolved by matching the From address against the inquiry's
 * recipient list, and anything unmatched is quarantined. That keeps one email
 * per event instead of one per recipient, which matters a great deal against
 * a 100-emails/day provider cap.
 */
@Injectable()
export class MailTokenService {
  constructor(private readonly config: ConfigService) {}

  private get secret(): string {
    return this.config.get<string>('mail.tokenSecret')!;
  }

  private get domain(): string {
    return this.config.get<string>('mail.domain')!;
  }

  tokenFor(inquiryId: string): string {
    return hmac(this.secret, inquiryId).slice(0, 24);
  }

  replyAddress(inquiryId: string): string {
    return `inq+${inquiryId}.${this.tokenFor(inquiryId)}@${this.domain}`;
  }

  /** Returns the inquiry id if the address is well-formed and the token verifies. */
  parseReplyAddress(address: string): string | null {
    const local = address.trim().toLowerCase().split('@')[0];
    if (!local?.startsWith('inq+')) return null;

    const payload = local.slice('inq+'.length);
    const separator = payload.lastIndexOf('.');
    if (separator <= 0) return null;

    const inquiryId = payload.slice(0, separator);
    const token = payload.slice(separator + 1);

    return safeEqual(token, this.tokenFor(inquiryId)) ? inquiryId : null;
  }

  /** Stable root Message-ID for an inquiry thread. Never changes. */
  rootMessageId(inquiryId: string): string {
    return `<inq-${inquiryId}@${this.domain}>`;
  }

  childMessageId(inquiryId: string, suffix: string): string {
    return `<inq-${inquiryId}-${suffix}@${this.domain}>`;
  }
}
