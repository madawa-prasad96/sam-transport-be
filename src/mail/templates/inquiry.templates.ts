import type { EmailEventType } from '../../generated/prisma/enums';
import {
  detailTableHtml,
  detailTableText,
  layout,
  textLayout,
  type DetailRow,
  type RenderedEmail,
} from './layout';

export interface InquiryEmailContext {
  inquiryNumber: string;
  subjectLine: string;
  actorName: string;
  actorCompanyName: string;
  requesterCompanyName: string;
  providerCompanyName: string;
  inquiryUrl: string;
  /** Event-specific rows rendered as the detail table. */
  details: DetailRow[];
  /** Free-form body text (decline reason, comment body, etc.). */
  message?: string;
}

const copy: Record<
  string,
  { heading: (c: InquiryEmailContext) => string; intro: (c: InquiryEmailContext) => string }
> = {
  INQUIRY_SUBMITTED: {
    heading: (c) => `New transport inquiry ${c.inquiryNumber}`,
    intro: (c) =>
      `${c.actorName} at ${c.requesterCompanyName} has requested a vehicle from ${c.providerCompanyName}.`,
  },
  INQUIRY_AMENDED: {
    heading: (c) => `Inquiry ${c.inquiryNumber} was amended`,
    intro: (c) => `${c.actorName} updated the details of this inquiry.`,
  },
  VEHICLE_PROVIDED: {
    heading: (c) => `Vehicle assigned for ${c.inquiryNumber}`,
    intro: (c) =>
      `${c.actorName} at ${c.providerCompanyName} has assigned a vehicle to this inquiry.`,
  },
  VEHICLE_UPDATED: {
    heading: (c) => `Vehicle details changed for ${c.inquiryNumber}`,
    intro: (c) =>
      `${c.actorName} at ${c.providerCompanyName} has revised the vehicle details. The previous details are no longer valid.`,
  },
  INQUIRY_DECLINED: {
    heading: (c) => `Inquiry ${c.inquiryNumber} was declined`,
    intro: (c) =>
      `${c.actorName} at ${c.providerCompanyName} is unable to provide a vehicle for this request.`,
  },
  INQUIRY_RESUBMITTED: {
    heading: (c) => `Inquiry ${c.inquiryNumber} was re-submitted`,
    intro: (c) =>
      `${c.actorName} has updated and re-submitted this inquiry for consideration.`,
  },
  INQUIRY_CANCELLED: {
    heading: (c) => `Inquiry ${c.inquiryNumber} was cancelled`,
    intro: (c) =>
      `${c.actorName} at ${c.requesterCompanyName} has cancelled this request. If a vehicle was already dispatched, please stand it down.`,
  },
  INQUIRY_COMPLETED: {
    heading: (c) => `Inquiry ${c.inquiryNumber} is complete`,
    intro: (c) => `${c.actorName} marked this inquiry as completed.`,
  },
  COMMENT_ADDED: {
    heading: (c) => `New comment on ${c.inquiryNumber}`,
    intro: (c) => `${c.actorName} at ${c.actorCompanyName} commented:`,
  },
  INBOUND_REPLY: {
    heading: (c) => `New reply on ${c.inquiryNumber}`,
    intro: (c) => `${c.actorName} replied by email:`,
  },
  RECIPIENT_ADDED: {
    heading: (c) => `You were added to inquiry ${c.inquiryNumber}`,
    intro: (c) =>
      `${c.actorName} added you to this transport inquiry. You will now receive updates on this thread.`,
  },
  NO_RESPONSE_REMINDER: {
    heading: (c) => `Reminder: ${c.inquiryNumber} is awaiting a response`,
    intro: (c) =>
      `This inquiry has not yet received vehicle details from ${c.providerCompanyName}.`,
  },
};

export const renderInquiryEmail = (
  eventType: EmailEventType,
  ctx: InquiryEmailContext,
): RenderedEmail => {
  const entry = copy[eventType] ?? {
    heading: (c: InquiryEmailContext) => `Update on ${c.inquiryNumber}`,
    intro: (c: InquiryEmailContext) => `${c.actorName} updated this inquiry.`,
  };

  const heading = entry.heading(ctx);
  const intro = entry.intro(ctx);

  const quoteHtml = ctx.message
    ? `<div style="margin:0 0 18px;padding:12px 14px;background:#f8fafc;border-left:3px solid #cbd5e1;border-radius:4px;font-size:14px;color:#0f172a;white-space:pre-wrap">${ctx.message
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</div>`
    : '';

  return {
    // The subject is frozen for the life of the inquiry — changing it fragments
    // the thread in most mail clients. See PRD §6.1.
    subject: ctx.subjectLine,
    html: layout({
      heading,
      intro,
      bodyHtml: quoteHtml + detailTableHtml(ctx.details),
      actionLabel: 'Open inquiry',
      actionUrl: ctx.inquiryUrl,
    }),
    text: textLayout({
      heading,
      intro,
      bodyText:
        (ctx.message ? `${ctx.message}\n\n` : '') + detailTableText(ctx.details),
      actionLabel: 'Open inquiry',
      actionUrl: ctx.inquiryUrl,
    }),
  };
};

export const renderUserInvitation = (ctx: {
  inviterName: string;
  companyName: string;
  acceptUrl: string;
  expiresInHours: number;
}): RenderedEmail => {
  const heading = `You've been invited to ${ctx.companyName}`;
  const intro = `${ctx.inviterName} has invited you to join ${ctx.companyName} on the Transport Inquiry Platform.`;
  const footer = `This invitation expires in ${ctx.expiresInHours} hours. If you weren't expecting it, you can ignore this email.`;

  return {
    subject: `Join ${ctx.companyName} on the Transport Inquiry Platform`,
    html: layout({
      heading,
      intro,
      bodyHtml: '',
      actionLabel: 'Accept invitation',
      actionUrl: ctx.acceptUrl,
      footerNote: footer,
    }),
    text: textLayout({
      heading,
      intro,
      bodyText: '',
      actionLabel: 'Accept invitation',
      actionUrl: ctx.acceptUrl,
      footerNote: footer,
    }),
  };
};

export const renderCompanyInvitation = (ctx: {
  inviterName: string;
  inviterCompanyName: string;
  invitedCompanyName: string;
  acceptUrl: string;
  expiresInHours: number;
}): RenderedEmail => {
  const heading = `${ctx.inviterCompanyName} wants to connect with you`;
  const intro =
    `${ctx.inviterName} at ${ctx.inviterCompanyName} has invited ${ctx.invitedCompanyName} onto the Transport Inquiry Platform, ` +
    `so transport requests between your companies are handled in one place instead of over email.`;
  const footer = `This invitation expires in ${ctx.expiresInHours} hours.`;

  return {
    subject: `${ctx.inviterCompanyName} invited you to the Transport Inquiry Platform`,
    html: layout({
      heading,
      intro,
      bodyHtml: '',
      actionLabel: 'Set up your company',
      actionUrl: ctx.acceptUrl,
      footerNote: footer,
    }),
    text: textLayout({
      heading,
      intro,
      bodyText: '',
      actionLabel: 'Set up your company',
      actionUrl: ctx.acceptUrl,
      footerNote: footer,
    }),
  };
};
