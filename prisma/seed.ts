import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { createHmac } from 'crypto';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const PASSWORD = 'Password123!';

const rootMessageId = (inquiryId: string) =>
  `<inq-${inquiryId}@${process.env.MAIL_DOMAIN ?? 'mail.localhost'}>`;

async function main() {
  console.log('Seeding…');

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  // --- Platform operator ---------------------------------------------------
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@platform.test' },
    update: { passwordHash, status: 'ACTIVE' },
    create: {
      email: 'admin@platform.test',
      fullName: 'Platform Super Admin',
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });

  // --- Two companies: a manufacturer and a shipping agent ------------------
  const manufacturer = await prisma.company.upsert({
    where: { id: '11111111-1111-4111-8111-111111111111' },
    update: {},
    create: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Lanka Precision Manufacturing',
      registrationNumber: 'PV-88213',
      addressLine: 'Zone 3, Katunayake Export Processing Zone',
      country: 'Sri Lanka',
      primaryContactName: 'Nirmal Fernando',
      primaryContactEmail: 'logistics@lankaprecision.test',
      primaryContactPhone: '+94 11 234 5678',
      timezone: 'Asia/Colombo',
      status: 'ACTIVE',
    },
  });

  const agent = await prisma.company.upsert({
    where: { id: '22222222-2222-4222-8222-222222222222' },
    update: {},
    create: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Horizon Freight Agencies',
      registrationNumber: 'PV-44190',
      addressLine: '14 Bristol Street, Colombo 01',
      country: 'Sri Lanka',
      primaryContactName: 'Dilani Perera',
      primaryContactEmail: 'ops@horizonfreight.test',
      primaryContactPhone: '+94 11 987 6543',
      timezone: 'Asia/Colombo',
      status: 'ACTIVE',
    },
  });

  // A third company, deliberately NOT connected — used by the isolation tests.
  const outsider = await prisma.company.upsert({
    where: { id: '33333333-3333-4333-8333-333333333333' },
    update: {},
    create: {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Unrelated Logistics Ltd',
      addressLine: '9 Independent Way, Kandy',
      country: 'Sri Lanka',
      primaryContactName: 'Outsider Admin',
      primaryContactEmail: 'admin@outsider.test',
      primaryContactPhone: '+94 81 111 2222',
      timezone: 'Asia/Colombo',
      status: 'ACTIVE',
    },
  });

  const users = await Promise.all(
    [
      {
        email: 'logistics@lankaprecision.test',
        fullName: 'Nirmal Fernando',
        role: 'COMPANY_ADMIN' as const,
        companyId: manufacturer.id,
      },
      {
        email: 'coordinator@lankaprecision.test',
        fullName: 'Ishara Silva',
        role: 'COMPANY_USER' as const,
        companyId: manufacturer.id,
      },
      {
        email: 'ops@horizonfreight.test',
        fullName: 'Dilani Perera',
        role: 'COMPANY_ADMIN' as const,
        companyId: agent.id,
      },
      {
        email: 'shipping@horizonfreight.test',
        fullName: 'Ruwan Jayasuriya',
        role: 'COMPANY_USER' as const,
        companyId: agent.id,
      },
      {
        email: 'admin@outsider.test',
        fullName: 'Outsider Admin',
        role: 'COMPANY_ADMIN' as const,
        companyId: outsider.id,
      },
    ].map((user) =>
      prisma.user.upsert({
        where: { email: user.email },
        update: { passwordHash, status: 'ACTIVE' },
        create: { ...user, passwordHash, status: 'ACTIVE', phone: '+94 77 000 0000' },
      }),
    ),
  );

  const agentUser = users.find(
    (u) => u.email === 'shipping@horizonfreight.test',
  )!;

  // --- Connection between the two (ordered pair, Rule C3) ------------------
  const [companyAId, companyBId] =
    manufacturer.id < agent.id
      ? [manufacturer.id, agent.id]
      : [agent.id, manufacturer.id];

  await prisma.connection.upsert({
    where: { companyAId_companyBId: { companyAId, companyBId } },
    update: { status: 'ACTIVE' },
    create: { companyAId, companyBId, status: 'ACTIVE' },
  });

  // --- A sample inquiry, mid-flight ---------------------------------------
  const year = new Date().getFullYear();
  await prisma.inquirySequence.upsert({
    where: { year },
    update: {},
    create: { year, lastNumber: 0 },
  });

  const existing = await prisma.inquiry.findFirst({
    where: { referenceNumber: 'PO-2026-4471' },
  });

  if (!existing) {
    const sequence = await prisma.inquirySequence.update({
      where: { year },
      data: { lastNumber: { increment: 1 } },
    });
    const number = `INQ-${year}-${String(sequence.lastNumber).padStart(4, '0')}`;
    const id = '44444444-4444-4444-8444-444444444444';

    const inquiry = await prisma.inquiry.create({
      data: {
        id,
        number,
        status: 'SUBMITTED',
        requesterCompanyId: agent.id,
        providerCompanyId: manufacturer.id,
        createdByUserId: agentUser.id,
        pickupLocation: 'Colombo Port, Terminal 2, Gate 4',
        pickupContactName: 'Sunil Wickrama',
        pickupContactPhone: '+94 77 555 1212',
        deliveryLocation: 'Lanka Precision Warehouse, Katunayake EPZ Zone 3',
        deliveryContactName: 'Ishara Silva',
        deliveryContactPhone: '+94 77 555 3434',
        readyByAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        requiredByAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        cargoDescription: 'Imported polymer granules, 20 pallets, shrink-wrapped',
        packageCount: 20,
        grossWeight: 18500.5,
        weightUom: 'KG',
        volumeCbm: 34.2,
        packagingType: 'PALLET',
        requestedVehicleType: 'CONTAINER_40',
        referenceNumber: 'PO-2026-4471',
        priority: 'URGENT',
        specialHandlingNotes:
          'Forklift required at delivery. Driver must carry the gate pass printout.',
        rootMessageId: rootMessageId(id),
        subjectLine: `[${number}] Colombo Port, Terminal 2... → Lanka Precision Wareho...`,
        submittedAt: new Date(),
      },
    });

    await prisma.recipient.createMany({
      data: [
        {
          inquiryId: inquiry.id,
          type: 'TO',
          kind: 'USER',
          email: agentUser.email,
          name: agentUser.fullName,
          userId: agentUser.id,
          addedByCompanyId: agent.id,
          addedByUserId: agentUser.id,
        },
        {
          inquiryId: inquiry.id,
          type: 'TO',
          kind: 'EXTERNAL',
          email: manufacturer.primaryContactEmail,
          name: manufacturer.primaryContactName,
          addedByCompanyId: manufacturer.id,
          addedByUserId: agentUser.id,
        },
        {
          inquiryId: inquiry.id,
          type: 'CC',
          kind: 'EXTERNAL',
          email: 'warehouse@lankaprecision.test',
          name: 'Warehouse Desk',
          addedByCompanyId: agent.id,
          addedByUserId: agentUser.id,
        },
      ],
      skipDuplicates: true,
    });

    await prisma.timelineEvent.create({
      data: {
        inquiryId: inquiry.id,
        type: 'INQUIRY_SUBMITTED',
        actorUserId: agentUser.id,
        actorName: agentUser.fullName,
        payload: {},
      },
    });

    console.log(`  created sample inquiry ${number}`);
  }

  // Signature the inbound webhook expects, printed so it can be tested by hand.
  const sampleToken = createHmac(
    'sha256',
    process.env.MAIL_TOKEN_SECRET ?? 'dev-mail-token-secret',
  )
    .update('44444444-4444-4444-8444-444444444444')
    .digest('hex')
    .slice(0, 24);

  console.log('\nSeed complete.\n');
  console.log(`  Password for every account: ${PASSWORD}\n`);
  console.log('  Super admin       admin@platform.test');
  console.log('  Manufacturer      logistics@lankaprecision.test    (admin)');
  console.log('                    coordinator@lankaprecision.test  (user)');
  console.log('  Shipping agent    ops@horizonfreight.test          (admin)');
  console.log('                    shipping@horizonfreight.test     (user)');
  console.log('  Unconnected co.   admin@outsider.test              (admin)');
  console.log(
    `\n  Sample inquiry reply address:\n    inq+44444444-4444-4444-8444-444444444444.${sampleToken}@${process.env.MAIL_DOMAIN ?? 'mail.localhost'}\n`,
  );
  console.log(`  Super admin id: ${superAdmin.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
