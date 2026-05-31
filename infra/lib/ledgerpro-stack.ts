/**
 * LedgerPro production infrastructure (AWS CDK v2, TypeScript).
 *
 * This stack is a STARTING POINT — review every resource, tag, and parameter
 * before deploying. It provisions a small-but-real production environment:
 *
 *   - 2-AZ VPC with public + private subnets, single NAT for cost
 *   - RDS PostgreSQL 16, Multi-AZ, automated backups, PITR, encrypted
 *   - ECS Fargate service for the Next.js app, autoscaling 2-6 tasks
 *   - Application Load Balancer in front, HTTPS via ACM cert
 *   - Secrets Manager for DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY
 *   - CloudWatch Logs (30-day retention), structured-JSON parsing
 *   - Health checks against /api/health?deep=1
 *
 * Estimated monthly cost at idle: ~$130–180 USD (NAT $32, ALB $20, RDS Multi-AZ
 * t4g.small $60, Fargate 2x 0.5vCPU/1GB ~$25, plus data/logs).
 *
 * Prerequisites:
 *   - CDK v2 installed and bootstrapped:  `cdk bootstrap`
 *   - An ACM cert for your domain in the deploy region
 *   - A Route53 hosted zone for the domain (optional, for the alias record)
 *
 * Deploy:
 *   cd infra && npm install
 *   cdk deploy LedgerProStack
 *
 * Required context (in cdk.json or via `--context`):
 *   - domainName       — e.g. "app.ledgerpro.io"
 *   - hostedZoneId     — Route53 zone id (optional)
 *   - certificateArn   — ACM cert ARN in the deploy region (us-east-1 for CloudFront, regional otherwise)
 *   - containerImage   — ECR image URI, e.g. "123456789.dkr.ecr.us-east-1.amazonaws.com/ledgerpro:v1"
 */

import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput, Tags } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'

export interface LedgerProStackProps extends StackProps {
  domainName: string
  certificateArn: string
  containerImage: string
  hostedZoneId?: string
}

export class LedgerProStack extends Stack {
  constructor(scope: Construct, id: string, props: LedgerProStackProps) {
    super(scope, id, props)
    Tags.of(this).add('app', 'ledgerpro')

    // ─── Networking ────────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1, // single NAT to cut costs; bump to 2 for HA
      subnetConfiguration: [
        { name: 'public',  cidrMask: 24, subnetType: ec2.SubnetType.PUBLIC },
        { name: 'private', cidrMask: 24, subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { name: 'data',    cidrMask: 28, subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    })

    // ─── Database ──────────────────────────────────────────────────────────
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', { vpc, description: 'RDS Postgres' })

    const db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_3 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      multiAz: true,
      allocatedStorage: 50,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      backupRetention: Duration.days(14),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      credentials: rds.Credentials.fromGeneratedSecret('ledgerpro_admin'),
      securityGroups: [dbSg],
      enablePerformanceInsights: true,
      cloudwatchLogsExports: ['postgresql'],
      databaseName: 'ledgerpro',
    })

    // ─── Application secrets ──────────────────────────────────────────────
    // DATABASE_URL is composed at runtime from the RDS secret + db host.
    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      description: 'JWT signing key for LedgerPro',
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
    })
    const encryptionKey = new secretsmanager.Secret(this, 'EncryptionKey', {
      description: 'AES-256-GCM key for at-rest field encryption',
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
    })

    // ─── Application: ECS Fargate behind ALB ──────────────────────────────
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsights: true,
    })

    const cert = acm.Certificate.fromCertificateArn(this, 'Cert', props.certificateArn)
    const logGroup = new logs.LogGroup(this, 'AppLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    })

    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'AppService', {
      cluster,
      desiredCount: 2,
      cpu: 512,
      memoryLimitMiB: 1024,
      assignPublicIp: false,
      taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      certificate: cert,
      redirectHTTP: true,
      domainName: props.domainName,
      domainZone: props.hostedZoneId
        ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.domainName.split('.').slice(-2).join('.'),
          })
        : undefined,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(props.containerImage),
        containerPort: 3000,
        logDriver: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'app' }),
        environment: {
          NODE_ENV: 'production',
          PORT: '3000',
          APP_NAME: 'LedgerPro',
          LOG_LEVEL: 'info',
          TRUSTED_ORIGINS: `https://${props.domainName}`,
        },
        secrets: {
          // Compose DATABASE_URL inline. Prisma reads this env var directly.
          DB_USERNAME: ecs.Secret.fromSecretsManager(db.secret!, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, 'password'),
          DB_HOST:     ecs.Secret.fromSecretsManager(db.secret!, 'host'),
          DB_PORT:     ecs.Secret.fromSecretsManager(db.secret!, 'port'),
          DB_NAME:     ecs.Secret.fromSecretsManager(db.secret!, 'dbname'),
          JWT_SECRET:       ecs.Secret.fromSecretsManager(jwtSecret),
          ENCRYPTION_KEY:   ecs.Secret.fromSecretsManager(encryptionKey),
        },
      },
    })

    // Compose DATABASE_URL in the container entrypoint, OR use a small
    // shell wrapper. Easiest: set it via a non-secret env using a CDK
    // override — but Prisma needs it as a real env var. For production we
    // recommend a 3-line entrypoint shim in the Dockerfile:
    //
    //   export DATABASE_URL="postgresql://$DB_USERNAME:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=require"
    //   exec node server.js

    // Tighten security group so only Fargate tasks can hit the DB.
    dbSg.addIngressRule(
      service.service.connections.securityGroups[0],
      ec2.Port.tcp(5432),
      'App tasks → RDS Postgres'
    )

    // Health checks against the deep probe.
    service.targetGroup.configureHealthCheck({
      path: '/api/health?deep=1',
      interval: Duration.seconds(30),
      timeout: Duration.seconds(10),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      healthyHttpCodes: '200',
    })

    // Autoscaling: scale on CPU and request count.
    const scaling = service.service.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 6 })
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: Duration.minutes(5),
      scaleOutCooldown: Duration.minutes(1),
    })
    scaling.scaleOnRequestCount('ReqScaling', {
      requestsPerTarget: 500,
      targetGroup: service.targetGroup,
    })

    // ─── Outputs ────────────────────────────────────────────────────────────
    new CfnOutput(this, 'DbEndpoint',  { value: db.dbInstanceEndpointAddress })
    new CfnOutput(this, 'AppUrl',      { value: `https://${props.domainName}` })
    new CfnOutput(this, 'JwtSecretArn',     { value: jwtSecret.secretArn })
    new CfnOutput(this, 'EncryptionKeyArn', { value: encryptionKey.secretArn })
  }
}
