# Transport Inquiry Platform — API

NestJS + Prisma + PostgreSQL backend. See `../PRD.md` for the product spec.

## Prerequisites

- Node 20+, pnpm
- PostgreSQL running locally
- [Mailpit](https://mailpit.axllent.org/) for local email capture: `brew install mailpit`

## Setup

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL for your local Postgres
createdb transport_management
pnpm db:migrate
pnpm db:generate
pnpm db:seed
```

## Running

```bash
mailpit --smtp 127.0.0.1:1025 --listen 127.0.0.1:8025   # inbox at :8025
pnpm start:dev                                           # API at :4000/api
```

## Seeded accounts

Password for all: `Password123!`

| Role | Email |
|---|---|
| Super admin | `admin@platform.test` |
| Manufacturer admin | `logistics@lankaprecision.test` |
| Manufacturer user | `coordinator@lankaprecision.test` |
| Shipping agent admin | `ops@horizonfreight.test` |
| Shipping agent user | `shipping@horizonfreight.test` |
| Unconnected company | `admin@outsider.test` |

The last account exists to prove tenant isolation: it must never be able to see
the other companies' inquiries.

## Architecture notes

**Outbox, not direct send.** Every email is written to `EmailMessage` inside the
request that caused it, and `OutboxProcessor` drains the queue on a timer. A mail
outage therefore delays delivery but never fails a user action or loses a
notification.

**Swappable mail transport.** `MAIL_TRANSPORT=smtp` uses Mailpit locally so
development costs no provider quota; `resend` is used in production. Switching is
a config change, never a code change.

**Threading.** Each inquiry owns a stable root `Message-ID`. Every later email
sets `In-Reply-To`/`References` to it and reuses the frozen subject line, so mail
clients collapse the whole inquiry into one conversation.

**BCC.** BCC addresses go into the SMTP *envelope* only — never the message
headers. Nodemailer will happily write a `Bcc:` header if you pass `bcc`, which
would show every recipient the hidden list; `SmtpTransport` avoids that
deliberately. BCC is hidden in the UI from everyone except the person who added
it and their own company admin, but is always written to the audit log.

(Note: Mailpit *displays* a synthesised `Bcc:` line for envelope-only recipients.
That is a feature of the test inbox, not something the sender emitted.)

**Inbound.** Cloudflare Email Routing → Email Worker → `POST /api/webhooks/inbound-email`,
HMAC-signed over the raw request bytes. The reply address carries an HMAC of the
inquiry id; the sender is then resolved by matching the From address against the
inquiry's recipients. Anything unattributable is quarantined, never auto-posted.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm start:dev` | Run with watch mode |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:seed` | Seed demo data |
| `pnpm db:studio` | Prisma Studio |
| `pnpm test` | Unit tests |
