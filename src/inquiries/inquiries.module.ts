import { Module } from '@nestjs/common';
import { ConnectionsModule } from '../connections/connections.module';
import { InquiriesController } from './inquiries.controller';
import { InquiriesService } from './inquiries.service';
import { RecipientsService } from './recipients.service';
import { RemindersService } from './reminders.service';

@Module({
  imports: [ConnectionsModule],
  controllers: [InquiriesController],
  providers: [InquiriesService, RecipientsService, RemindersService],
  exports: [InquiriesService],
})
export class InquiriesModule {}
