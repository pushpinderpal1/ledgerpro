# LedgerPro — AWS Infrastructure (CDK)

This directory contains a starter AWS CDK stack for deploying LedgerPro to
production-grade infrastructure. It is **not turn-key** — review and adjust
to your requirements before deploying.

## What it provisions

- VPC with public, private (egress), and isolated (data) subnets across 2 AZs
- RDS PostgreSQL 16, Multi-AZ, encrypted, 14-day backups, PITR
- ECS Fargate service running the Next.js app, autoscaling 2–6 tasks
- Application Load Balancer with HTTPS (your ACM cert)
- AWS Secrets Manager for `JWT_SECRET`, `ENCRYPTION_KEY`, and the RDS credentials
- CloudWatch Logs (30-day retention) and Container Insights
- ALB health checks pointed at `/api/health?deep=1`
- Route 53 alias record (optional, if you pass `hostedZoneId`)

## Prerequisites

1. **AWS account** with admin or sufficient IAM permissions
2. **AWS CLI** configured (`aws configure`)
3. **Node.js 18+**
4. **CDK v2** installed globally: `npm install -g aws-cdk`
5. **CDK bootstrapped** in your account/region: `cdk bootstrap`
6. **ACM certificate** for your domain in the deployment region
7. **Docker image** of the app pushed to ECR or another public registry

## Build the Docker image

In the **project root** (not this folder), create a `Dockerfile`:

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json prisma ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
USER nextjs
EXPOSE 3000
# Compose DATABASE_URL from the parts injected by Fargate's Secret mappings,
# run migrations, then start.
CMD sh -c 'export DATABASE_URL="postgresql://$DB_USERNAME:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=require" && \
           npx prisma migrate deploy && \
           node server.js'
```

Add to `next.config.js`:
```js
module.exports = { output: 'standalone' /* …existing config… */ }
```

Build and push:
```bash
aws ecr create-repository --repository-name ledgerpro --region us-east-1
aws ecr get-login-password --region us-east-1 | docker login --username AWS \
  --password-stdin <acct>.dkr.ecr.us-east-1.amazonaws.com
docker build -t ledgerpro:v1 .
docker tag ledgerpro:v1 <acct>.dkr.ecr.us-east-1.amazonaws.com/ledgerpro:v1
docker push <acct>.dkr.ecr.us-east-1.amazonaws.com/ledgerpro:v1
```

## Deploy

```bash
cd infra
npm install
cdk deploy \
  -c domainName=app.yourdomain.com \
  -c certificateArn=arn:aws:acm:us-east-1:123:certificate/abc... \
  -c containerImage=<acct>.dkr.ecr.us-east-1.amazonaws.com/ledgerpro:v1 \
  -c hostedZoneId=Z123ABCDEFGHIJ      # optional
```

First deploy takes 15–25 minutes (RDS Multi-AZ is the slowest step).

## Cost estimate (us-east-1, idle)

| Component                                  | Approx. monthly |
|--------------------------------------------|----------------:|
| RDS Postgres t4g.small Multi-AZ + 50 GB    |          $60–70 |
| NAT Gateway (1)                            |            $32  |
| ALB                                        |            $20  |
| Fargate 2 × 0.5 vCPU / 1 GB                |          $20–25 |
| CloudWatch Logs / Container Insights       |           $5–10 |
| Secrets Manager (3 secrets)                |             $1  |
| **Total**                                  |       **~$140–160** |

Scale-down options:
- Drop `multiAz: false` for $30/mo less (accept ~5 min failover)
- Use Aurora Serverless v2 instead (different scaling profile)
- Use App Runner instead of Fargate+ALB (~$20/mo less, less control)

## Production checklist before going live

- [ ] Set `deletionProtection: true` on the DB (already on)
- [ ] Take a manual snapshot before any major migration
- [ ] Set up CloudWatch alarms: ALB 5xx rate, RDS CPU > 80%, Fargate task failures
- [ ] Enable AWS WAF on the ALB (especially for auth endpoints)
- [ ] Subscribe an SNS topic to billing alerts
- [ ] Test full DB restore from snapshot at least once
- [ ] Document the runbook for: incident response, secret rotation, deploys
- [ ] Configure Sentry (`SENTRY_DSN` env var) — see `src/lib/errors.ts`
- [ ] Review IAM roles; the default Fargate task role is broad enough but check
