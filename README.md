# Data Gone in 60 Seconds – An ETL Pipeline using AWS SAM

**Data Gone in 60 Seconds** is an AWS serverless ETL pipeline that demonstrates how to ingest, transform, and deliver sensor data. The project leverages several AWS services including Lambda, S3, Athena, SQS, and the AWS Glue Data Catalog. It also uses a custom external endpoint (powered by [val.town](https://val.town)) to simulate a data warehouse.

## Overview

This pipeline consists of three main stages:

1. **Data Ingestion**  
   - **Lambda:** `ingestData.ts`  
   - **What it does:**  
     - Accepts a POST with an array of sensor records.  
     - Extracts the **date** (YYYY-MM-DD) from the first record's `timestamp`.  
     - Writes a single newline-delimited JSON file under  
       `s3://<bucket>/raw/year={YYYY}/month={MM}/day={DD}/{uuid}.json`.  
     - **Partitions by date only** (year, month, day) for much faster Athena scans and no hour/minute bloat.

2. **Data Transformation with Athena**  
   - **Lambda:** `runAthenaQuery.ts`  
   - **What it does:**  
     - Kicks off an Athena query (on **AwsDataCatalog → my_athena_database**) that:  
       - Converts Fahrenheit to Celsius.  
       - Filters by date partition (`year`, `month`, `day`) and any in-SQL time/temperature predicates.  
     - Writes query results (CSV) to  
       `s3://<bucket>/transformed/{queryExecutionId}.csv`.  
     - Sends each matching row as a JSON message to the SQS queue.  
     - **IAM:** locked down to only the `raw/` and `transformed/` prefixes plus Glue/athena metadata calls.

3. **Batch Delivery to External Endpoint**  
   - **Lambda:** `sendToExternalBatch.ts`  
   - **What it does:**  
     - Triggered by SQS in batches (configurable size/window).  
     - Posts the batch of JSON messages in one HTTP `POST` to your Val Town endpoint  
       (set via `EXTERNAL_ENDPOINT_URL` in the SAM template).  
     - The external service (SQLite on Val Town) ingests these records into its own table.
   - **Val Town Integration:** `valTownWebhook.ts`
     - Provides a serverless SQLite database endpoint that receives and stores the processed sensor data.
     - Creates a dynamic table based on the webhook filename.
     - Handles data validation and provides detailed response with insertion statistics.


## Prerequisites
- AWS Account - AWS User with console and command line access - set up AWS Creds
- AWS CLI - aws-cli/2.24.1 Python/3.12.6 Linux/6.5.0-1025-azure exe/x86_64.ubuntu.20s
- AWS SAM CLI - version 1.133.0
- NodeJS - v20.18.1

## Architecture Diagram

```
       +------------------+
       |  API Gateway     | <-- Protected by API Key
       +--------+---------+
                |
                v
       +------------------+       Enriched JSON
       | DataIngestFunction| -----------------------> S3 (raw data, partitioned)
       +------------------+
                |
                v
       +------------------+
       | AthenaQueryFunction |  <-- Runs query on partitioned S3 data via Glue Catalog
       +------------------+
                |
                v
       +------------------+
       | SQS Queue        |  <-- Holds filtered query results
       +------------------+
                |
                v
       +------------------+
       | SendToExternalBatchFunction |  <-- Batches messages and sends a POST request
       +------------------+
                |
                v
       +------------------+
       | External Endpoint (val.town) |
       +------------------+
```

## Project Components

### 1. Data Ingestion (ingestData.ts)

- **Functionality:**  
  Accepts a POST request with sensor data, extracts or uses the current timestamp, and writes the data to an S3 bucket under a partitioned key such as:
  ```
  raw/YYYY/MM/DD/HH/mm/<uuid>.json
  ```
- **Key Debugging Points:**  
  - Ensured that the payload is enriched with an `objectKey`.
  - Handled invalid JSON by returning a 400 response.

### 2. Athena Query (runAthenaQuery.ts)

- **Functionality:**  
  Executes an Athena query on the raw data table to filter records within a specific time partition and temperature range. The query converts `rawTemperature` (Fahrenheit) to Celsius and returns matching records.
- **Key Debugging Points:**  
  - Ensured the query string is constructed correctly with proper partition filters.
  - Explicitly specified the Athena catalog and database in the query execution context.
  - Faced issues with IAM permissions and typos in ARNs which were resolved.
  - Implemented a polling mechanism that repeatedly checks Athena for query completion before retrieving results.

### 3. Batch Delivery to External Endpoint (sendToExternalBatch.ts)

- **Functionality:**  
  Triggered by SQS, this function batches incoming messages and sends them as a single POST request to the external endpoint.  
- **Key Debugging Points:**  
  - Added retry logic with exponential backoff for the outbound HTTP POST.
  - Configured SQS event source mapping with a batching window to accumulate messages.
  - Updated the external endpoint URL to `https://pchinjr-externaldatawarehouse.web.val.run`.
  - Adjusted the IAM policies to restrict SQS send permissions to the correct queue ARN.

## AWS X-Ray Integration

This project implements AWS X-Ray to provide distributed tracing and performance monitoring across the entire ETL pipeline. X-Ray helps visualize the application's components, identify performance bottlenecks, and troubleshoot request failures.

### X-Ray Implementation Details

1. **SAM Template Configuration**
   - Each Lambda function has X-Ray tracing enabled via the `Tracing: Active` property
   - IAM permissions for X-Ray actions (`xray:PutTraceSegments` and `xray:PutTelemetryRecords`) are included in the Lambda execution roles

2. **Lambda Function Instrumentation**
   - AWS SDK clients are automatically instrumented when X-Ray tracing is enabled
   - Custom subsegments are created for critical operations:
     - S3 write operations in the ingestion function
     - Athena query execution and polling
     - SQS message processing
     - HTTP requests to the external endpoint

3. **Trace Analysis**
   - The X-Ray service map provides a visual representation of the entire pipeline
   - Trace details show the execution time for each component
   - Annotations and metadata are added to segments to provide context for debugging

4. **Monitoring and Troubleshooting**
   - X-Ray traces can be viewed in the AWS X-Ray console
   - CloudWatch integrates with X-Ray to provide metrics and alarms based on trace data
   - Trace data helps identify bottlenecks, such as slow Athena queries or external API calls

### Enabling X-Ray Locally

For local development and testing with X-Ray:

```bash
# Install the X-Ray daemon
wget https://s3.us-east-2.amazonaws.com/aws-xray-assets.us-east-2/xray-daemon/aws-xray-daemon-linux-3.x.zip
unzip aws-xray-daemon-linux-3.x.zip
sudo mv xray /usr/local/bin/

# Run the X-Ray daemon locally
xray -o -n us-east-1
```

When running functions locally with SAM, enable X-Ray with:

```bash
sam local invoke -t template.yaml --parameter-overrides ParameterKey=EnableXRay,ParameterValue=true
```

### Viewing X-Ray Traces

After deploying the application:

1. Navigate to the AWS X-Ray console
2. Select "Service map" to view the end-to-end flow of requests
3. Click on any node to see detailed trace information
4. Use the "Traces" view to filter and analyze specific requests
5. Look for error traces or traces with high latency to identify issues

## Val Town Integration

This project uses [Val Town](https://val.town) as a serverless endpoint to simulate a data warehouse. Val Town is a cloud environment for running JavaScript/TypeScript functions as APIs, webhooks, and scheduled jobs.

### Val Town Webhook Implementation

The `valTownWebhook.ts` file contains the code that runs on Val Town and serves as the external endpoint for our ETL pipeline:

1. **Dynamic Table Creation**
   - The webhook automatically creates an SQLite table named after the file (e.g., `externalDataWarehouse_sensor_data`)
   - Table schema includes fields for sensor data plus a timestamp for when records were received

2. **Data Processing**
   - Accepts batched JSON payloads from the Lambda function
   - Validates each record before insertion
   - Handles both camelCase and lowercase field names for flexibility
   - Provides detailed response with success status and insertion counts

3. **Error Handling**
   - Validates request method (only accepts POST)
   - Validates payload structure (expects an array)
   - Logs errors for malformed entries
   - Returns appropriate HTTP status codes and error messages

### Setting Up Val Town Integration

1. **Create a Val Town Account**
   - Sign up at [val.town](https://val.town)
   - Create a new "val" (function) with the code from `valTownWebhook.ts`
   - Name it `externalDataWarehouse` to match the expected table name

2. **Deploy the Webhook**
   - Val Town automatically deploys your function as a web endpoint
   - Copy the webhook URL (e.g., `https://username-externaldatawarehouse.web.val.run`)
   - Configure this URL in your SAM template as the `EXTERNAL_ENDPOINT_URL` environment variable

3. **Testing the Integration**
   - After deploying both the AWS pipeline and Val Town webhook, you can test the end-to-end flow
   - Use the SQLite interface in Val Town to query your data:
     ```sql
     SELECT * FROM externalDataWarehouse_sensor_data;
     ```
   - Monitor incoming requests in the Val Town logs

4. **Benefits of Val Town**
   - Serverless: No infrastructure to manage
   - Built-in SQLite database: Persistent storage without additional setup
   - Web interface: Easy to monitor and query data
   - Logs: Detailed request and error logging
   - Cost-effective: Free tier available for development and testing

The Val Town integration provides a lightweight, serverless solution for the final destination of our ETL pipeline, simulating a data warehouse without the need for complex infrastructure setup.

## Deployment Instructions

1. **Fork & Clone**  
   - Fork the GitHub repo and open it in a new Codespace.

2. **Configure AWS Credentials**  
   ```bash
   aws configure
   ```  
   Enter your AWS Access Key, Secret, default region, etc.

3. **Set Up Val Town Data Warehouse**  
   - In Val Town, create an "externalDataWarehouse" endpoint.  
   - Copy its full URL (e.g. `https://pchinjr-externaldatawarehouse.web.val.run`).
   - https://docs.val.town/vals/http/

4. **Bake the Val Town URL into the Lambda**  
   - Open your `template.yaml` (SAM template).  
   - Under the **SendToExternalBatchFunction** resource's `Environment.Variables`, set:  
     ```yaml
     EXTERNAL_ENDPOINT_URL: "https://pchinjr-externaldatawarehouse.web.val.run"
     ```  
   - This ensures `sendToExternalBatch.ts` posts to your Val Town endpoint.

5. **Install the Build Tool**  
   ```bash
   npm install -g esbuild
   ```

6. **Build the SAM App**  
   ```bash
   sam build --manifest ./package.json
   ```

7. **Deploy with Guided Prompts**  
   ```bash
   sam deploy --guided
   ```  
   - Note down the **API Gateway URL**.  
   - Note down the **API Key** (or find it in the CloudFormation Outputs).

8. **Prepare Athena**  
   Use your actual bucket name `datagonein60-rawdata-837132623653` in every LOCATION. In Athena, run:

    ```sql
    -- 1) Drop old metadata
    DROP DATABASE IF EXISTS my_athena_database CASCADE;

    -- 2) Recreate pointing at the new raw prefix
    CREATE DATABASE my_athena_database
      LOCATION 's3://datagonein60-rawdata-837132623653/raw/';

    -- 3) Define the table with date-only partitions
    CREATE EXTERNAL TABLE my_athena_database.my_raw_data_table (
      sensorid       STRING,
      rawtemperature DOUBLE,
      rawhumidity    DOUBLE,
      timestamp      STRING,
      objectkey      STRING
    )
    PARTITIONED BY (
      year  STRING,
      month STRING,
      day   STRING
    )
    ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
    WITH SERDEPROPERTIES (
      'ignore.malformed.json' = 'true'
    )
    STORED AS TEXTFILE
    LOCATION 's3://datagonein60-rawdata-837132623653/raw/';

    -- 4) Register all existing partitions
    MSCK REPAIR TABLE my_athena_database.my_raw_data_table;

    -- 5) Verify
    SHOW PARTITIONS my_athena_database.my_raw_data_table;
    SELECT * 
      FROM my_athena_database.my_raw_data_table 
    LIMIT 10;
    ```

9. **Ingest Sample Data**  
   ```bash
   curl -X POST \
     -H "Content-Type: application/json" \
     -H "x-api-key: <API_KEY>" \
     -d @samplePayloads.json \
     https://<API_ID>.execute-api.<region>.amazonaws.com/Prod/ingest
   ```

10. **Verify S3 Storage**  
    - In the S3 console, confirm files under `s3://datagonein60-rawdata/raw/year=YYYY/month=MM/day=DD/…`

11. **Run & Test the Athena Query Lambda**  
    - In the Lambda console, open **runAthenaQuery** → **Test** → invoke.  
    - Confirm `"processedRows"` > 0 and logs show your SQL.

12. **Inspect SQS Messages**  
    - In SQS console, open **ProcessedDataQueue** → **Messages available**  
    - Optionally, **Receive message** to peek at the JSON bodies.

13. **Validate Delivery to Val Town**  
    - In your Val Town SQLite endpoint, run:
      ```sql
      SELECT * FROM externalDataWarehouse_sensor_data;
      ```
    - To clear and re-check:
      ```sql
      DELETE FROM <that_table>;
      SELECT * FROM <that_table>;
      ```
    - https://docs.val.town/std/sqlite/

## Conclusion

This project demonstrates how to build a serverless ETL pipeline using AWS SAM that ingests sensor data, transforms it using Athena, and delivers processed records in batched requests to an external endpoint. We've iterated through a debugging process to resolve issues with IAM permissions, metadata propagation, and batching logic. The integration with AWS X-Ray provides valuable insights into the performance and behavior of the pipeline, making it easier to monitor and troubleshoot in production environments.
  
---
# Debug Process
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
- build out sqs batch lambda function and create val.town endpoint to receive json
- git check point - feat: complete pipeline with valtown integration
- problem: athena needs line breaks in json for multiple objects
- problem: literal partion path values need to handled during ingest
- fix IAM for new glue operations from ingest lambda
- tons of changes to the IAM policies to enable the query lamba the correct actions
