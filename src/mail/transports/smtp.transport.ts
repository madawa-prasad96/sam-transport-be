import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type {
  MailTransport,
  OutboundMessage,
  SendResult,
} from './mail-transport.interface';

/** Pulls the bare address out of `Name <a@b.test>`. */
const extractAddress = (value: string): string => {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1] : value).trim();
};

/** Used in development against Mailpit, so local testing costs no provider quota. */
@Injectable()
export class SmtpTransport implements MailTransport {
  private readonly logger = new Logger(SmtpTransport.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: config.get<string>('mail.smtpHost'),
      port: config.get<number>('mail.smtpPort'),
      secure: config.get<boolean>('mail.smtpSecure'),
      // Mailpit accepts anything; real SMTP would supply auth here.
      tls: { rejectUnauthorized: false },
    });
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    // Nodemailer writes a `Bcc:` header into the compiled message when you pass
    // `bcc`, which would show every recipient the hidden list — exactly what BCC
    // must not do. So BCC addresses go into the SMTP envelope only, and the
    // message itself carries just the visible To/Cc headers.
    const envelopeTo = [...message.to, ...message.cc, ...message.bcc];

    // nodemailer types sendMail's result as `any`, which trips the type-aware
    // lint rules. Narrow it to the one field actually used.
    const info = (await this.transporter.sendMail({
      from: message.from,
      to: message.to.length ? message.to : undefined,
      cc: message.cc.length ? message.cc : undefined,
      envelope: {
        from: extractAddress(message.from),
        to: envelopeTo,
      },
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      messageId: message.messageId,
      inReplyTo: message.inReplyTo ?? undefined,
      references: message.references ?? undefined,
    })) as { messageId?: string };

    this.logger.debug(`Sent ${message.messageId} via SMTP`);
    return { providerMessageId: info.messageId };
  }
}
