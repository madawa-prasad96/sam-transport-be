import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  MailTransport,
  OutboundMessage,
  SendResult,
} from './mail-transport.interface';

/**
 * Production transport. Resend's free tier is 3,000/month capped at 100/day and
 * received mail counts against the same quota — see PRD §10.1 before raising
 * per-event send volume.
 *
 * Uses the REST API directly rather than the SDK to keep the dependency surface
 * small; the payload is stable and tiny.
 */
@Injectable()
export class ResendTransport implements MailTransport {
  private readonly logger = new Logger(ResendTransport.name);
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('mail.resendApiKey') ?? '';
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: message.from,
        to: message.to,
        cc: message.cc.length ? message.cc : undefined,
        bcc: message.bcc.length ? message.bcc : undefined,
        reply_to: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: {
          'Message-ID': message.messageId,
          ...(message.inReplyTo ? { 'In-Reply-To': message.inReplyTo } : {}),
          ...(message.references ? { References: message.references } : {}),
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Resend rejected the message (${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as { id?: string };
    this.logger.debug(`Sent ${message.messageId} via Resend`);
    return { providerMessageId: data.id };
  }
}
