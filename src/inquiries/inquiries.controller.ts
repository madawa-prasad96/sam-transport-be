import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateCommentDto,
  CreateInquiryDto,
  DeclineInquiryDto,
  ListInquiriesDto,
  ProvideVehicleDto,
  UpdateInquiryDto,
} from './dto/inquiry.dto';
import { AddRecipientDto } from './dto/recipient.dto';
import { InquiriesService } from './inquiries.service';
import { RecipientsService } from './recipients.service';

@Controller('inquiries')
export class InquiriesController {
  constructor(
    private readonly inquiries: InquiriesService,
    private readonly recipients: RecipientsService,
  ) {}

  @Get()
  list(@Query() query: ListInquiriesDto, @CurrentUser() user: AuthUser) {
    return this.inquiries.list(user, query);
  }

  @Post()
  create(@Body() dto: CreateInquiryDto, @CurrentUser() user: AuthUser) {
    return this.inquiries.create(user, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inquiries.findOne(user, id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInquiryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inquiries.update(user, id, dto);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inquiries.submit(user, id);
  }

  @Post(':id/vehicle')
  provideVehicle(
    @Param('id') id: string,
    @Body() dto: ProvideVehicleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inquiries.provideVehicle(user, id, dto);
  }

  @Post(':id/decline')
  decline(
    @Param('id') id: string,
    @Body() dto: DeclineInquiryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inquiries.decline(user, id, dto);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inquiries.cancel(user, id, reason);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inquiries.complete(user, id);
  }

  // --- Timeline, comments, email trace ------------------------------------

  @Get(':id/timeline')
  timeline(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inquiries.timeline(user, id);
  }

  @Get(':id/comments')
  comments(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inquiries.comments(user, id);
  }

  @Post(':id/comments')
  addComment(
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inquiries.addComment(user, id, dto);
  }

  @Get(':id/emails')
  emailLog(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inquiries.emailLog(user, id);
  }

  // --- Recipients (CC / BCC) ----------------------------------------------

  @Post(':id/recipients')
  addRecipient(
    @Param('id') id: string,
    @Body() dto: AddRecipientDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.recipients.add(user, id, dto);
  }

  @Delete(':id/recipients/:recipientId')
  removeRecipient(
    @Param('id') id: string,
    @Param('recipientId') recipientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.recipients.remove(user, id, recipientId);
  }
}
