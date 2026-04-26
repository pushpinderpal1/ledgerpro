# LedgerPro — Multi-Entity Accounting Platform

Full-stack accounting application for accounting firms. Supports unlimited legal entities,
role-based access control per entity, and all core accounting modules.

---

## Feature Overview

| Module | Description |
|--------|-------------|
| Multi-tenancy | Unlimited legal entities per firm, isolated data per entity |
| User & Roles | 7 role tiers (Owner → Client View), per-entity assignments |
| Chart of Accounts | Fully customizable CoA with hierarchy, seeded defaults |
| Journal Entries | Double-entry validation, draft/post/void workflow, audit trail |
| QB IIF | Parse and generate QuickBooks IIF for transactions, accounts, payroll |
| Budget & MIS | Annual budgets, variance analysis, MIS dashboard, P&L statement |
| AP Tracker | Invoice entry, aging buckets, payment tracking, auto journal entries |
| Payroll Engine | 2024 federal + state taxes, FICA, Medicare, auto payroll journal |
| W-2 / 1040-K | W-2 box generation, Schedule K-1 allocation, SSA export |
| Audit Log | Every write action logged with before/after values |

---

## Roles & Permissions

| Role | Accounts | Journals | AP | Payroll | Budget | Users |
|------|----------|----------|----|---------|--------|-------|
| OWNER | ✓ write | ✓ write | ✓ write | ✓ write | ✓ write | ✓ full |
| ADMIN | ✓ write | ✓ write | ✓ write | ✓ write | ✓ write | ✓ invite/remove |
| ACCOUNTANT | ✓ write | ✓ write | ✓ write | ✗ | ✓ write | ✗ |
| AUDITOR | ✓ read | ✓ read | ✗ | ✗ | ✓ read | ✗ |
| AP_CLERK | ✗ | ✗ | ✓ write | ✗ | ✗ | ✗ |
| PAYROLL_CLERK | ✗ | ✗ | ✗ | ✓ write | ✗ | ✗ |
| CLIENT_VIEW | ✓ read | ✗ | ✗ | ✗ | ✓ read | ✗ |

---

## Tech Stack

- **Frontend**: Next.js 14 App Router (React, TypeScript) — single-page app shell
- **Backend**: Next.js API Routes (Node.js) — REST API
- **Database**: PostgreSQL via Supabase — row-level security per entity
- **ORM**: Prisma — type-safe queries, migrations
- **Auth**: JWT sessions via `jose`, bcrypt password hashing, httpOnly cookies
- **Hosting**: Vercel (recommended) — 1-click deploy, auto SSL, CDN

---

## Local Development

### Prerequisites
- Node.js 18+
- A Supabase project (or local PostgreSQL)

### Steps

```bash
# 1. Clone and install
git clone <your-repo>
cd ledgerpro
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Supabase credentials

# 3. Generate Prisma client
npm run db:generate

# 4. Push schema to database
npm run db:push

# 5. Seed demo data
npm run db:seed

# 6. Start development server
npm run dev
```

Open http://localhost:3000

**Demo credentials (after seeding):**
| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@ledgerpro.com | Admin123! |
| Owner | owner@apexaccounting.com | Owner123! |
| Accountant | accountant@apexaccounting.com | Acct123! |
| Auditor | auditor@apexaccounting.com | Audit123! |
| AP Clerk | apclerk@apexaccounting.com | Clerk123! |
| Payroll | payroll@apexaccounting.com | Payroll123! |
| Client View | client@techstartup.com | Client123! |

---

## Production Deployment (Vercel + Supabase)

### Step 1 — Create Supabase project
1. Go to [supabase.com](https://supabase.com) and create a new project
2. Go to Settings → Database → Connection string
3. Copy both the **pooler URL** (for `DATABASE_URL`) and **direct URL** (for `DIRECT_URL`)
4. Go to Settings → API and copy your project URL and anon key

### Step 2 — Run migrations
```bash
# Set DATABASE_URL in your local .env first, then:
npx prisma migrate deploy
npm run db:seed
```

### Step 3 — Deploy to Vercel
1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) → Import project
3. Add environment variables from your `.env`:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `JWT_SECRET` (generate: `openssl rand -base64 32`)
   - `ENCRYPTION_KEY` (generate: `openssl rand -hex 32`)
   - `NEXT_PUBLIC_APP_URL` = your Vercel URL
4. Click Deploy — live in ~2 minutes

### Step 4 — First login
Visit your Vercel URL, sign up (or use seeded credentials), and create your firm.

---

## Project Structure

```
ledgerpro/
├── prisma/
│   ├── schema.prisma        # Full database schema
│   └── seed.ts              # Demo data + default CoA
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/        # login, register, logout
│   │   │   ├── entities/    # Legal entity CRUD
│   │   │   ├── accounts/    # Chart of accounts
│   │   │   ├── journals/    # Journal entries
│   │   │   ├── ap/          # AP tracker
│   │   │   ├── payroll/     # Payroll + W-2
│   │   │   ├── budget/      # Budget & MIS
│   │   │   ├── iif/         # QB IIF import/export
│   │   │   └── users/       # User management
│   │   ├── layout.tsx       # Root layout
│   │   └── page.tsx         # Full SPA (all UI)
│   ├── lib/
│   │   ├── auth/            # JWT, roles, permissions
│   │   ├── db.ts            # Prisma singleton
│   │   ├── iif/             # IIF parser + generator
│   │   └── payroll/         # Tax calculation engine
│   └── middleware.ts        # Route protection
├── .env.example
├── next.config.js
├── package.json
└── tsconfig.json
```

---

## Adding More Legal Entities

Any authenticated user can create new legal entities from the entity switcher (top-left sidebar).
Each new entity gets a seeded default Chart of Accounts and the creator is assigned OWNER role.
Users can be invited to any entity with any role independently of their role in other entities.

---

## Extending the Application

### Add a new module
1. Add tables to `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name add_module`
3. Add API route in `src/app/api/[module]/route.ts`
4. Add permission in `src/lib/auth/index.ts` → `MODULE_PERMISSIONS`
5. Add page component in `src/app/page.tsx`

### Add a new role
1. Add to the `EntityRole` enum in schema.prisma
2. Add to `ROLE_HIERARCHY` in `src/lib/auth/index.ts`
3. Add permissions in `MODULE_PERMISSIONS`
4. Update `MODULE_ACCESS` in `src/app/page.tsx`

---

## Security Notes

- Passwords hashed with bcrypt (12 rounds)
- SSNs stored encrypted (AES via ENCRYPTION_KEY)
- JWT stored in httpOnly, sameSite, secure cookie
- Every API route validates entity access before any DB operation
- Audit log records every write operation with user, timestamp, before/after values
- Row-level security can be added at the Supabase level for extra isolation
