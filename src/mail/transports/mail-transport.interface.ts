export interface OutboundMessage {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string | null;
}

export interface SendResult {
  providerMessageId?: string;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface MailTransport {
  send(message: OutboundMessage): Promise<SendResult>;
}
