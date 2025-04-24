# Data Gone in 60 Seconds – An ETL Pipeline using AWS SAM

**Data Gone in 60 Seconds** is an AWS serverless ETL pipeline that demonstrates how to ingest, transform, and deliver sensor data. The project leverages several AWS services including Lambda, S3, Athena, SQS, and the AWS Glue Data Catalog. It also uses a custom external endpoint (powered by [val.town](https://val.town)) to simulate a data warehouse.

## Overview

This pipeline is composed of three major components:

1. **Data Ingestion**  
   A Lambda function (`ingestData.ts`) receives POST requests containing sensor data, enriches the payload with a computed S3 key (based on a timestamp), and writes the data to an S3 bucket partitioned by date and time.

2. **Data Transformation with Athena**  
   Another Lambda function (`runAthenaQuery.ts`) runs an Athena query against the partitioned raw data. The query converts temperatures from Fahrenheit to Celsius and filters data based on a specified time window and temperature range. Matching records are sent to an SQS queue.

3. **Batch Delivery to External Endpoint**  
   A final Lambda function (`sendToExternalBatch.ts`) is triggered by SQS. It batches multiple messages together and sends them in a single POST request to an external endpoint (e.g., [https://pchinjr-externaldatawarehouse.web.val.run](https://pchinjr-externaldatawarehouse.web.val.run)). The endpoint uses SQLite to store the sensor data.

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

## Deployment Instructions

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/yourusername/data-gone-60.git
   cd data-gone-60
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Build the Application:**
   ```bash
   sam build --manifest ./package.json
   ```

4. **Deploy the Stack:**
   ```bash
   sam deploy --guided
   ```
   Follow the prompts to specify your stack name, AWS region, and other parameters.

## Testing the Pipeline

- **Local Testing:**  
  Use `sam local invoke` to test individual Lambda functions.
  - Example for testing the Athena query function locally:
    ```bash
    sam local invoke AthenaQueryFunction --event sample-athena-query.json
    ```
  - For SQS-triggered functions, simulate an SQS event using a sample JSON file.

- **End-to-End Testing:**  
  1. Send a POST request to your API Gateway endpoint (with the proper API key) to ingest sensor data.
  2. Ensure that new data is written to S3 with a partitioned key.
  3. Run the AthenaQueryFunction (either via the console or scheduled) to process data and send messages to SQS.
  4. Verify that the SendToExternalBatchFunction processes the SQS messages and sends a single batch POST to the external endpoint.
  5. Confirm that the external endpoint logs the successful insertion of data into its SQLite database.

## Debugging & Troubleshooting

During development, we encountered several challenges:
- **Missing Enrichment:**  
  Initially, old data lacked the `objectKey` field. After updating the ingestion function to enrich the payload, new data included this field.
- **Athena Query Issues:**  
  We ran into TABLE_NOT_FOUND errors due to IAM permissions and typographical errors in ARNs. Explicitly specifying the Athena catalog (`AwsDataCatalog`) and correcting the IAM policies resolved this.
- **SQS Message Batching:**  
  We configured a batching window to throttle requests to the external endpoint and implemented exponential backoff in case of errors.
- **Local vs. Deployed Differences:**  
  Using `sam local invoke` worked as expected, but invoking via the AWS Lambda console required ensuring all environment variables and IAM permissions were identical between local and production environments.

## Conclusion

This project demonstrates how to build a serverless ETL pipeline using AWS SAM that ingests sensor data, transforms it using Athena, and delivers processed records in batched requests to an external endpoint. We’ve iterated through a debugging process to resolve issues with IAM permissions, metadata propagation, and batching logic. 
  
---

This README provides a comprehensive guide for new users and documents the challenges and solutions encountered during development.

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
- build out sqs batch lambda function and create val.town endpoint to receive json
- git check point - feat: complete pipeline with valtown integration
- problem: athena needs line breaks in json for multiple objects
- problem: literal partion path values need to handled during ingest
- fix IAM for new glue operations from ingest lambda

1. **Fork & Clone**  
   - Fork the GitHub repo and open it in a new Codespace.

2. **Configure AWS Credentials**  
   ```bash
   aws configure
   ```  
   Enter your AWS Access Key, Secret, default region, etc.

3. **Set Up Val Town Data Warehouse**  
   - In Val Town, create an “externalDataWarehouse” endpoint.  
   - Copy its full URL (e.g. `https://api.val.town/data-warehouse`).

4. **Bake the Val Town URL into the Lambda**  
   - Open your `template.yaml` (SAM template).  
   - Under the **SendToExternalBatchFunction** resource’s `Environment.Variables`, set:  
     ```yaml
     EXTERNAL_ENDPOINT_URL: "https://api.val.town/data-warehouse"
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
   In the Athena console or via CLI, run:
   ```sql
   CREATE DATABASE IF NOT EXISTS my_athena_database
     LOCATION 's3://datagonein60-rawdata/raw/';
   
   CREATE EXTERNAL TABLE my_athena_database.my_raw_data_table (
     sensorid       STRING,
     rawtemperature DOUBLE,
     rawhumidity    DOUBLE,
     timestamp      STRING,
     objectkey      STRING
   )
   PARTITIONED BY (year STRING, month STRING, day STRING)
   ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
   STORED AS TEXTFILE
   LOCATION 's3://datagonein60-rawdata/raw/';
   
   MSCK REPAIR TABLE my_athena_database.my_raw_data_table;
   ```

9. **Ingest Sample Data**  
   ```bash
   curl -X POST \
     -H "Content-Type: application/json" \
     -H "x-api-key: <API_KEY>" \
     -d @sample-payload.json \
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
      SELECT * FROM <endpoint-script-name>_sensor_data_1;
      ```
    - To clear and re-check:
      ```sql
      DELETE FROM <that_table>;
      SELECT * FROM <that_table>;
      ```
   
You’re now ready to fork, deploy, ingest, and see your data flow from API → S3 → Athena → SQS → Val Town!