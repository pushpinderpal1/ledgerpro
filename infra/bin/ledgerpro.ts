#!/usr/bin/env node
import { App } from 'aws-cdk-lib'
import { LedgerProStack } from './lib/ledgerpro-stack'

const app = new App()

const domainName     = app.node.tryGetContext('domainName')     as string
const certificateArn = app.node.tryGetContext('certificateArn') as string
const containerImage = app.node.tryGetContext('containerImage') as string
const hostedZoneId   = app.node.tryGetContext('hostedZoneId')   as string | undefined

if (!domainName || !certificateArn || !containerImage) {
  console.error('Missing required context: domainName, certificateArn, containerImage')
  console.error('Pass via cdk.json or --context, e.g.:')
  console.error('  cdk deploy -c domainName=app.example.com -c certificateArn=arn:... -c containerImage=...')
  process.exit(1)
}

new LedgerProStack(app, 'LedgerProStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  domainName,
  certificateArn,
  containerImage,
  hostedZoneId,
})
