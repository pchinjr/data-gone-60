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
- git check point - feat: initial deploy successful
- adding unit test with jest, debugging type errors, debugging s3 client mock, simplified mocks
- set up lambda for "dependency injection" to allow test mocking of s3 client
- debugging service linked role for logging on the apigateway, cant be set from SAM template. 
- created trust-policy.json and created role then attached a policy to that role
- `aws iam create-role --role-name APIGatewayCWLogsRole --assume-role-policy-document file://trust-policy.json`
- `aws iam attach-role-policy --role-name APIGatewayCWLogsRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs`
- look up the api key by ID from apigw console
- debug right combination of esbuild order of operations and file directories
- `sam build --manifest ./package.json` - tells SAM to transpile and bundle functions
- `sam deploy` then deploys to the cloud
- git check point - feat: tests builds deploys works
- Setting up Athena from console. Connect to S3 Bucket, then create a database, then create a table, then run a query. 
- Queries can be run from Lambda functions
- refactor ingestion lambda to partion data according to date for filtering
- git check point - feat: ingest data to date time partitions in s3
- debugging athenaquery function with correct set of iam permissions
- debugging athenaquery function, the output partition doesn't exist, must manually make ahead of time /transformed
- had to look in the athena console query history to see the actual error message from athena that was a permission error for glue catalog. since athena uses glue, it also needs ability to read it
- debugging error of missing table, sam invoke local to get detailed error response, problem in SQS_QUEUE_URL
- using sam invoke local with hard coding the queue url makes it work, but the lambda console test does not, it still reports that the table does not exist. `sam local invoke AthenaQueryFunction --event sample-athena-query.json`
- aws lambda invoke --function-name data-gone-60-AthenaQueryFunction-t4LVXkcRrJPZ output.json --payload '{}'
- debugging missing table, I had a typo in the resource, and then figured out the cascade of IAM policies afterwards
- git check point - feat: Athena works and SQS works
