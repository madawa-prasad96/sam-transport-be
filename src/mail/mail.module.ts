import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailTokenService } from './mail-token.service';
import { MailService } from './mail.service';
import { OutboxProcessor } from './outbox.processor';
import { MAIL_TRANSPORT } from './transports/mail-transport.interface';
import { ResendTransport } from './transports/resend.transport';
import { SmtpTransport } from './transports/smtp.transport';

@Global()
@Module({
  providers: [
    MailService,
    MailTokenService,
    OutboxProcessor,
    SmtpTransport,
    ResendTransport,
    {
      // Swapping providers is a config change, never a code change — which is
      // what lets local development run against Mailpit at zero quota cost.
      provide: MAIL_TRANSPORT,
      inject: [ConfigService, SmtpTransport, ResendTransport],
      useFactory: (
        config: ConfigService,
        smtp: SmtpTransport,
        resend: ResendTransport,
      ) =>
        config.get<string>('mail.transport') === 'resend' ? resend : smtp,
    },
  ],
  exports: [MailService, MailTokenService],
})
export class MailModule {}
