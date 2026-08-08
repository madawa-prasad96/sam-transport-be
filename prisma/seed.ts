import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const PASSWORD = 'Password123!';

const rootMessageId = (inquiryId: string) =>
  `<inq-${inquiryId}@${process.env.MAIL_DOMAIN ?? 'mail.localhost'}>`;

const hoursFromNow = (hours: number) =>
  new Date(Date.now() + hours * 60 * 60 * 1000);

/** Stable ids keep re-seeding idempotent and make manual testing predictable. */
const UNIT = {
  corporate: '11111111-1111-4111-8111-111111111111',
  transport: '22222222-2222-4222-8222-222222222222',
  lotus: '33333333-3333-4333-8333-333333333333',
  diendra: '44444444-4444-4444-8444-444444444444',
  stores: '55555555-5555-4555-8555-555555555555',
} as const;

async function main() {
  console.log('Seeding SAM units…');

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  // --- Units --------------------------------------------------------------
  // A plant, a department and an internally-named entity are all just Units.
  const unitSpecs = [
    {
      id: UNIT.corporate,
      name: 'SAM Corporate',
      code: 'CORP',
      addressLine: '1 Industrial Avenue, Colombo 01',
      primaryContactName: 'Nadeesha Fernando',
      primaryContactEmail: 'corporate@sam.com',
      primaryContactPhone: '+94 11 200 0000',
    },
    {
      id: UNIT.transport,
      name: 'SAM Central Transport',
      code: 'TRANSPORT',
      addressLine: 'Transport Yard, Peliyagoda',
      primaryContactName: 'Ruwan Jayasuriya',
      primaryContactEmail: 'transport@sam.com',
      primaryContactPhone: '+94 11 200 0100',
    },
    {
      id: UNIT.lotus,
      name: 'SAM Lotus',
      code: 'LOTUS',
      addressLine: 'Lotus Plant, Katunayake EPZ',
      primaryContactName: 'Dilani Perera',
      primaryContactEmail: 'lotus@sam.com',
      primaryContactPhone: '+94 11 200 0200',
    },
    {
      id: UNIT.diendra,
      name: 'SAM Diendra',
      code: 'DIENDRA',
      addressLine: 'Diendra Plant, Thulhiriya',
      primaryContactName: 'Kasun Bandara',
      primaryContactEmail: 'diendra@sam.com',
      primaryContactPhone: '+94 11 200 0300',
    },
    {
      id: UNIT.stores,
      name: 'Central Stores Department',
      code: 'STORES',
      addressLine: 'Main Warehouse, Ekala',
      primaryContactName: 'Ishara Silva',
      primaryContactEmail: 'stores@sam.com',
      primaryContactPhone: '+94 11 200 0400',
    },
  ];

  for (const spec of unitSpecs) {
    await prisma.unit.upsert({
      where: { id: spec.id },
      update: {},
      create: {
        ...spec,
        country: 'Sri Lanka',
        timezone: 'Asia/Colombo',
        defaultWeightUom: 'KG',
        status: 'ACTIVE',
      },
    });
  }

  // --- People -------------------------------------------------------------
  const userSpecs = [
    // SAM-wide administrator. Belongs to a real unit and can raise inquiries
    // like anyone else — they simply also see every unit.
    {
      email: 'admin@sam.com',
      fullName: 'Nadeesha Fernando',
      phone: '+94 77 100 0001',
      role: 'ORG_ADMIN' as const,
      unitId: UNIT.corporate,
    },
    {
      email: 'transport.head@sam.com',
      fullName: 'Ruwan Jayasuriya',
      phone: '+94 77 100 0002',
      role: 'UNIT_ADMIN' as const,
      unitId: UNIT.transport,
    },
    {
      email: 'dispatch@sam.com',
      fullName: 'Malith Gunawardena',
      phone: '+94 77 100 0003',
      role: 'UNIT_USER' as const,
      unitId: UNIT.transport,
    },
    {
      email: 'lotus.admin@sam.com',
      fullName: 'Dilani Perera',
      phone: '+94 77 100 0004',
      role: 'UNIT_ADMIN' as const,
      unitId: UNIT.lotus,
    },
    {
      email: 'lotus.stores@sam.com',
      fullName: 'Sanjeewa Rathnayake',
      phone: '+94 77 100 0005',
      role: 'UNIT_USER' as const,
      unitId: UNIT.lotus,
    },
    {
      email: 'diendra.admin@sam.com',
      fullName: 'Kasun Bandara',
      phone: '+94 77 100 0006',
      role: 'UNIT_ADMIN' as const,
      unitId: UNIT.diendra,
    },
    {
      email: 'stores.admin@sam.com',
      fullName: 'Ishara Silva',
      phone: '+94 77 100 0007',
      role: 'UNIT_ADMIN' as const,
      unitId: UNIT.stores,
    },
  ];

  const users: Record<string, { id: string; fullName: string }> = {};
  for (const spec of userSpecs) {
    const user = await prisma.user.upsert({
      where: { email: spec.email },
      update: { passwordHash, status: 'ACTIVE' },
      create: { ...spec, passwordHash, status: 'ACTIVE' },
    });
    users[spec.email] = { id: user.id, fullName: user.fullName };
  }

  // --- A worked example: Lotus asks Central Transport for a vehicle -------
  const existing = await prisma.inquiry.findFirst({
    where: { number: 'INQ-2026-0001' },
  });

  if (!existing) {
    await prisma.inquirySequence.upsert({
      where: { year: 2026 },
      update: {},
      create: { year: 2026, lastNumber: 1 },
    });

    const id = '99999999-9999-4999-8999-999999999999';
    const creator = users['lotus.stores@sam.com'];

    const inquiry = await prisma.inquiry.create({
      data: {
        id,
        number: 'INQ-2026-0001',
        status: 'SUBMITTED',
        requesterUnitId: UNIT.lotus,
        providerUnitId: UNIT.transport,
        createdByUserId: creator.id,
        pickupLocation: 'Lotus Plant, Katunayake EPZ — Gate 2',
        pickupContactName: 'Sanjeewa Rathnayake',
        pickupContactPhone: '+94 77 100 0005',
        deliveryLocation: 'Main Warehouse, Ekala',
        deliveryContactName: 'Ishara Silva',
        deliveryContactPhone: '+94 77 100 0007',
        readyByAt: hoursFromNow(18),
        requiredByAt: hoursFromNow(36),
        cargoDescription: 'Finished goods — 12 pallets of moulded components',
        packageCount: 12,
        grossWeight: 4800,
        weightUom: 'KG',
        volumeCbm: 22.5,
        packagingType: 'PALLET',
        requestedVehicleType: 'LORRY_LARGE',
        referenceNumber: 'PO-88412',
        priority: 'NORMAL',
        specialHandlingNotes: 'Forklift available at both ends. Gate pass required.',
        rootMessageId: rootMessageId(id),
        subjectLine:
          '[INQ-2026-0001] Lotus Plant, Katunayake EPZ → Main Warehouse, Ekala',
        submittedAt: new Date(),
      },
    });

    await prisma.recipient.createMany({
      data: [
        {
          inquiryId: inquiry.id,
          type: 'TO',
          kind: 'USER',
          email: 'lotus.stores@sam.com',
          name: 'Sanjeewa Rathnayake',
          userId: creator.id,
          addedByUnitId: UNIT.lotus,
        },
        {
          inquiryId: inquiry.id,
          type: 'TO',
          kind: 'USER',
          email: 'transport@sam.com',
          name: 'Ruwan Jayasuriya',
          addedByUnitId: UNIT.lotus,
        },
        {
          inquiryId: inquiry.id,
          type: 'CC',
          kind: 'USER',
          email: 'stores.admin@sam.com',
          name: 'Ishara Silva',
          addedByUnitId: UNIT.lotus,
        },
        {
          // External parties still matter: the haulier is not a SAM user.
          inquiryId: inquiry.id,
          type: 'CC',
          kind: 'EXTERNAL',
          email: 'ops@rapidhaulage.test',
          name: 'Rapid Haulage (contract carrier)',
          addedByUnitId: UNIT.lotus,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.timelineEvent.createMany({
      data: [
        {
          inquiryId: inquiry.id,
          type: 'INQUIRY_CREATED',
          actorUserId: creator.id,
          actorName: creator.fullName,
          payload: { number: inquiry.number },
        },
        {
          inquiryId: inquiry.id,
          type: 'INQUIRY_SUBMITTED',
          actorUserId: creator.id,
          actorName: creator.fullName,
          payload: { to: 'SAM Central Transport' },
        },
      ],
    });
  }

  console.log('\nSeeded. All accounts use the password:', PASSWORD);
  console.table(
    userSpecs.map((u) => ({
      email: u.email,
      role: u.role,
      unit: unitSpecs.find((x) => x.id === u.unitId)?.name,
    })),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
