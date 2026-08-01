export interface AppConfig {
  nodeEnv: string;
  port: number;
  webAppUrl: string;
  corsOrigins: string[];
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  invitationTtlHours: number;
  mail: {
    transport: 'smtp' | 'resend';
    domain: string;
    fromAddress: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    resendApiKey: string;
    tokenSecret: string;
    inboundWebhookSecret: string;
  };
  storage: {
    driver: 'local';
    localPath: string;
    maxFileSizeBytes: number;
    maxInquiryStorageBytes: number;
  };
  reminders: {
    firstHours: number;
    escalationHours: number;
  };
}

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 4000),
  webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:3000',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },
  invitationTtlHours: int(process.env.INVITATION_TTL_HOURS, 72),
  mail: {
    transport: (process.env.MAIL_TRANSPORT as 'smtp' | 'resend') ?? 'smtp',
    domain: process.env.MAIL_DOMAIN ?? 'mail.localhost',
    fromAddress:
      process.env.MAIL_FROM_ADDRESS ??
      'Transport Platform <no-reply@mail.localhost>',
    smtpHost: process.env.SMTP_HOST ?? '127.0.0.1',
    smtpPort: int(process.env.SMTP_PORT, 1025),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    tokenSecret: process.env.MAIL_TOKEN_SECRET ?? 'dev-mail-token-secret',
    inboundWebhookSecret:
      process.env.INBOUND_WEBHOOK_SECRET ?? 'dev-inbound-webhook-secret',
  },
  storage: {
    driver: 'local',
    localPath: process.env.STORAGE_LOCAL_PATH ?? './storage',
    maxFileSizeBytes: int(process.env.MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024),
    maxInquiryStorageBytes: int(
      process.env.MAX_INQUIRY_STORAGE_BYTES,
      50 * 1024 * 1024,
    ),
  },
  reminders: {
    firstHours: int(process.env.REMINDER_FIRST_HOURS, 24),
    escalationHours: int(process.env.REMINDER_ESCALATION_HOURS, 48),
  },
});
