# data-gone-60
Example code for Data Gone in 60 Seconds

Webhook to receive batched JSON from data source
- API Gateway
- Lambda receives and puts to S3

Athena
- create table from S3 data
- filter and put in new S3

SQS 
- SQS Queue to hold finished data as message
- Lambda to poll queue and POST to external endpoint

MOCKS
- incoming data
- data warehouse landing endpoint

# Prerequisites
- AWS Account - AWS User with console and command line access - set up AWS Creds
- AWS CLI - aws-cli/2.24.1 Python/3.12.6 Linux/6.5.0-1025-azure exe/x86_64.ubuntu.20s
- AWS SAM CLI - version 1.133.0
- NodeJS - v20.18.1

# Process
- AWS SSO User signed into console, given creds and set environment vars
- ```export AWS_ACCESS_KEY_ID="xxxxxx"
    export AWS_SECRET_ACCESS_KEY="xxxxxxx"
    export AWS_SESSION_TOKEN="xxxxxx"
    export AWS_DEFAULT_REGION="us-east-1"```
- `npm init` and set up `tsc` and `npm i` deps
- Create template.yaml
- create /src/ingestData.ts
- create tsconfig.json
- `sam validate` to check template.yaml
- `sam deploy --guided` for the first time
- debug stage name conflicts, removed existing sam deployment cfn, battling order of operations to deploy apigw with keys
- the first SAM template.yaml has just one lambda, api gateway, and api key usage plans, and an s3 bucket
- debug stage name conflicts again, the api key usage plan depends on the stage existing first. 
- When SAM templates are in `ROLLBACK_COMPLETE` state has to be deleted with `sam delete --stack-name data-gone-60 --region us-east-1`