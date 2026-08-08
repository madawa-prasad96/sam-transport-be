-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ORG_ADMIN', 'UNIT_ADMIN', 'UNIT_USER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "NotificationPreference" AS ENUM ('INSTANT', 'DAILY_DIGEST');

-- CreateEnum
CREATE TYPE "WeightUom" AS ENUM ('KG', 'LB');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VEHICLE_PROVIDED', 'DECLINED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "PackagingType" AS ENUM ('PALLET', 'CARTON', 'CRATE', 'DRUM', 'BAG', 'LOOSE', 'CONTAINER', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('VAN', 'LORRY_SMALL', 'LORRY_MEDIUM', 'LORRY_LARGE', 'FLATBED', 'TRAILER', 'CONTAINER_20', 'CONTAINER_40', 'REEFER', 'OTHER');

-- CreateEnum
CREATE TYPE "RecipientType" AS ENUM ('TO', 'CC', 'BCC');

-- CreateEnum
CREATE TYPE "RecipientKind" AS ENUM ('USER', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "TimelineEventType" AS ENUM ('INQUIRY_CREATED', 'INQUIRY_SUBMITTED', 'INQUIRY_AMENDED', 'VEHICLE_PROVIDED', 'VEHICLE_UPDATED', 'INQUIRY_DECLINED', 'INQUIRY_RESUBMITTED', 'INQUIRY_CANCELLED', 'INQUIRY_COMPLETED', 'COMMENT_ADDED', 'INBOUND_REPLY', 'RECIPIENT_ADDED', 'RECIPIENT_REMOVED', 'ATTACHMENT_ADDED');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('INQUIRY_SUBMITTED', 'INQUIRY_AMENDED', 'VEHICLE_PROVIDED', 'VEHICLE_UPDATED', 'INQUIRY_DECLINED', 'INQUIRY_RESUBMITTED', 'INQUIRY_CANCELLED', 'INQUIRY_COMPLETED', 'COMMENT_ADDED', 'INBOUND_REPLY', 'RECIPIENT_ADDED', 'NO_RESPONSE_REMINDER', 'DAILY_DIGEST', 'USER_INVITED', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'FAILED');

-- CreateEnum
CREATE TYPE "InboundEmailStatus" AS ENUM ('PROCESSED', 'QUARANTINED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "CommentSource" AS ENUM ('APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "addressLine" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "primaryContactName" TEXT NOT NULL,
    "primaryContactEmail" TEXT NOT NULL,
    "primaryContactPhone" TEXT NOT NULL,
    "logoUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "defaultWeightUom" "WeightUom" NOT NULL DEFAULT 'KG',
    "status" "UnitStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "notificationPreference" "NotificationPreference" NOT NULL DEFAULT 'INSTANT',
    "unitId" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "InquiryStatus" NOT NULL DEFAULT 'DRAFT',
    "requesterUnitId" TEXT NOT NULL,
    "providerUnitId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "pickupLocation" TEXT NOT NULL,
    "pickupContactName" TEXT NOT NULL,
    "pickupContactPhone" TEXT NOT NULL,
    "deliveryLocation" TEXT NOT NULL,
    "deliveryContactName" TEXT NOT NULL,
    "deliveryContactPhone" TEXT NOT NULL,
    "readyByAt" TIMESTAMP(3) NOT NULL,
    "requiredByAt" TIMESTAMP(3) NOT NULL,
    "cargoDescription" TEXT NOT NULL,
    "packageCount" INTEGER NOT NULL,
    "grossWeight" DECIMAL(12,3) NOT NULL,
    "weightUom" "WeightUom" NOT NULL DEFAULT 'KG',
    "volumeCbm" DECIMAL(12,3),
    "dimensions" TEXT,
    "packagingType" "PackagingType",
    "requestedVehicleType" "VehicleType",
    "referenceNumber" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "specialHandlingNotes" TEXT,
    "declineReason" TEXT,
    "rootMessageId" TEXT NOT NULL,
    "subjectLine" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "lastReminderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleDetail" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "transporterName" TEXT,
    "driverName" TEXT NOT NULL,
    "driverPhone" TEXT NOT NULL,
    "expectedPickupAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "type" "RecipientType" NOT NULL,
    "kind" "RecipientKind" NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "userId" TEXT,
    "addedByUnitId" TEXT NOT NULL,
    "addedByUserId" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" "CommentSource" NOT NULL DEFAULT 'APP',
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "authorUserId" TEXT,
    "authorEmail" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "commentId" TEXT,
    "vehicleDetailId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "type" "TimelineEventType" NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT,
    "eventType" "EmailEventType" NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "inReplyTo" TEXT,
    "references" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailRecipient" (
    "id" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "type" "RecipientType" NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "userId" TEXT,
    "replyToAddress" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "deliveredAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),

    CONSTRAINT "EmailRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT,
    "recipientId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "subject" TEXT,
    "rawMessageId" TEXT,
    "inReplyTo" TEXT,
    "bodyText" TEXT NOT NULL,
    "strippedText" TEXT,
    "status" "InboundEmailStatus" NOT NULL,
    "quarantineReason" TEXT,
    "commentId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressedEmail" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "unitId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "invitedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "unitId" TEXT,
    "inquiryId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquirySequence" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InquirySequence_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_code_key" ON "Unit"("code");

-- CreateIndex
CREATE INDEX "Unit_status_idx" ON "Unit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_unitId_status_idx" ON "User"("unitId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_number_key" ON "Inquiry"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_rootMessageId_key" ON "Inquiry"("rootMessageId");

-- CreateIndex
CREATE INDEX "Inquiry_requesterUnitId_status_createdAt_idx" ON "Inquiry"("requesterUnitId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Inquiry_providerUnitId_status_createdAt_idx" ON "Inquiry"("providerUnitId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Inquiry_status_submittedAt_idx" ON "Inquiry"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "Inquiry_referenceNumber_idx" ON "Inquiry"("referenceNumber");

-- CreateIndex
CREATE INDEX "VehicleDetail_vehicleNumber_idx" ON "VehicleDetail"("vehicleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleDetail_inquiryId_version_key" ON "VehicleDetail"("inquiryId", "version");

-- CreateIndex
CREATE INDEX "Recipient_inquiryId_type_idx" ON "Recipient"("inquiryId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_inquiryId_email_key" ON "Recipient"("inquiryId", "email");

-- CreateIndex
CREATE INDEX "Comment_inquiryId_createdAt_idx" ON "Comment"("inquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "Attachment_inquiryId_idx" ON "Attachment"("inquiryId");

-- CreateIndex
CREATE INDEX "TimelineEvent_inquiryId_createdAt_idx" ON "TimelineEvent"("inquiryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_messageId_key" ON "EmailMessage"("messageId");

-- CreateIndex
CREATE INDEX "EmailMessage_status_scheduledAt_idx" ON "EmailMessage"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "EmailMessage_inquiryId_createdAt_idx" ON "EmailMessage"("inquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailRecipient_emailMessageId_idx" ON "EmailRecipient"("emailMessageId");

-- CreateIndex
CREATE INDEX "EmailRecipient_email_idx" ON "EmailRecipient"("email");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmail_commentId_key" ON "InboundEmail"("commentId");

-- CreateIndex
CREATE INDEX "InboundEmail_status_receivedAt_idx" ON "InboundEmail"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressedEmail_email_key" ON "SuppressedEmail"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_email_status_idx" ON "Invitation"("email", "status");

-- CreateIndex
CREATE INDEX "AuditEvent_inquiryId_createdAt_idx" ON "AuditEvent"("inquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_unitId_createdAt_idx" ON "AuditEvent"("unitId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_requesterUnitId_fkey" FOREIGN KEY ("requesterUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_providerUnitId_fkey" FOREIGN KEY ("providerUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDetail" ADD CONSTRAINT "VehicleDetail_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleDetail" ADD CONSTRAINT "VehicleDetail_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_vehicleDetailId_fkey" FOREIGN KEY ("vehicleDetailId") REFERENCES "VehicleDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailRecipient" ADD CONSTRAINT "EmailRecipient_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
