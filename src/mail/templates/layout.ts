export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface DetailRow {
  label: string;
  value: string | null | undefined;
}

const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const rows = (items: DetailRow[]): DetailRow[] =>
  items.filter(
    (row) => row.value !== null && row.value !== undefined && row.value !== '',
  );

export const detailTableHtml = (items: DetailRow[]): string => {
  const body = rows(items)
    .map(
      (row) => `
      <tr>
        <td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;vertical-align:top;white-space:nowrap">${escape(row.label)}</td>
        <td style="padding:6px 0;color:#0f172a;font-size:13px">${escape(String(row.value))}</td>
      </tr>`,
    )
    .join('');
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">${body}</table>`;
};

export const detailTableText = (items: DetailRow[]): string =>
  rows(items)
    .map((row) => `  ${row.label}: ${String(row.value)}`)
    .join('\n');

export const button = (label: string, url: string): string =>
  `<a href="${escape(url)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600">${escape(label)}</a>`;

export const layout = (options: {
  heading: string;
  intro: string;
  bodyHtml: string;
  actionLabel?: string;
  actionUrl?: string;
  footerNote?: string;
}): string => `
<div style="background:#f1f5f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:10px;padding:28px;border:1px solid #e2e8f0">
    <h1 style="margin:0 0 6px;font-size:18px;color:#0f172a">${escape(options.heading)}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.5">${escape(options.intro)}</p>
    ${options.bodyHtml}
    ${
      options.actionLabel && options.actionUrl
        ? `<div style="margin-top:24px">${button(options.actionLabel, options.actionUrl)}</div>`
        : ''
    }
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:26px 0 14px" />
    <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5">
      ${escape(options.footerNote ?? 'Reply to this email to add a comment to the inquiry. Everyone on this thread will be notified.')}
    </p>
  </div>
</div>`;

export const textLayout = (options: {
  heading: string;
  intro: string;
  bodyText: string;
  actionLabel?: string;
  actionUrl?: string;
  footerNote?: string;
}): string =>
  [
    options.heading,
    '='.repeat(options.heading.length),
    '',
    options.intro,
    '',
    options.bodyText,
    options.actionUrl ? `\n${options.actionLabel}: ${options.actionUrl}` : '',
    '',
    '---',
    options.footerNote ??
      'Reply to this email to add a comment to the inquiry. Everyone on this thread will be notified.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
