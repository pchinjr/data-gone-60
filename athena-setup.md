Below is a step‐by‐step guide to add Athena into your pipeline so that you can:

1. Query the partitioned raw data (from your ingestion function) for a specific time window,  
2. Convert the temperatures from Fahrenheit to Celsius, and  
3. Send only the matching records to an SQS queue for delivery to your external data warehouse.

We'll cover creating an Athena database and table, writing the query, adding a new Lambda function to run the query, and wiring up an SQS queue.

---

## Step 1: Create an Athena Database

1. **Log in to the Athena Console:**  
   Navigate to the [Athena Console](https://console.aws.amazon.com/athena/).

2. **Create a Database:**  
   Run a SQL command such as:  
   ```sql
   CREATE DATABASE IF NOT EXISTS my_athena_database;
   ```  
   This database will house your table definitions.

---

## Step 2: Create an Athena Table for Raw Data

Your ingestion function writes JSON files to S3 under a partitioned path (e.g., `raw/YYYY/MM/DD/HH/mm/<uuid>.json`). Create an Athena table that is partitioned by these time components.

1. **Open the Athena Query Editor.**
2. **Run a DDL Statement Similar to the Following:**  
   ```sql
   CREATE EXTERNAL TABLE IF NOT EXISTS my_raw_data_table (
     sensorId string,
     rawTemperature double,
     rawHumidity double,
     timestamp string,
     objectKey string
   )
   PARTITIONED BY (year string, month string, day string, hour string, minute string)
   ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
   WITH SERDEPROPERTIES (
     'ignore.malformed.json' = 'true'
   )
   LOCATION 's3://datagonein60-rawdata/raw/';
   ```
3. **Add Partitions:**  
   After ingesting data, you must load partitions into the table. For example, run an ALTER TABLE command for a specific partition:  
   ```sql
   ALTER TABLE my_raw_data_table 
     ADD PARTITION (year='2025', month='02', day='10', hour='12', minute='05')
     LOCATION 's3://datagonein60-rawdata/raw/2025/02/10/12/05/';
   ```  
   In production, you might automate partition discovery using AWS Glue crawlers or by running an MSCK REPAIR TABLE command.

---

## Step 3: Write the Transformation Query

Develop a SQL query that:
- Selects records from a specific partition (or a range of partitions),
- Filters rows based on a temperature range (after converting the temperature from Fahrenheit to Celsius),
- And outputs the desired columns.

For example:
```sql
SELECT 
  sensorId,
  (rawTemperature - 32) * 5/9 AS temperatureC,
  rawHumidity,
  timestamp,
  objectKey
FROM my_raw_data_table
WHERE year='2025'
  AND month='02'
  AND day='10'
  AND hour='12'
  AND minute='05'
  AND ((rawTemperature - 32) * 5/9) BETWEEN 20 AND 25;
```
This query converts `rawTemperature` into Celsius and filters for values between 20°C and 25°C for data in the partition `2025/02/10/12/05`.

---

## Step 4: Add an Athena Query Lambda Function

Create a new Lambda function that uses the Athena client (AWS SDK v3) to run the above query. It should:
- Be configured with environment variables (database, table, output S3 location, SQS queue URL, and query parameters such as time partition and temperature range).
- Poll for query completion.
- Retrieve the query results.
- For each matching record, send a message to an SQS queue.

### Sample Code: `src/runAthenaQuery.ts`

```typescript
import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } from "@aws-sdk/client-athena";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";

const athenaClient = new AthenaClient({});
const sqsClient = new SQSClient({});

// Configuration from environment variables
const DATABASE = process.env.ATHENA_DATABASE || "my_athena_database";
const RAW_TABLE = process.env.ATHENA_TABLE || "my_raw_data_table";
const OUTPUT_LOCATION = process.env.ATHENA_OUTPUT_LOCATION || "s3://datagonein60-rawdata/transformed/";
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL || "";
// Query parameters for the time window and temperature range
const QUERY_YEAR = process.env.QUERY_YEAR || "2025";
const QUERY_MONTH = process.env.QUERY_MONTH || "02";
const QUERY_DAY = process.env.QUERY_DAY || "10";
const QUERY_HOUR = process.env.QUERY_HOUR || "12";
const QUERY_MINUTE = process.env.QUERY_MINUTE || "05";
const TEMP_MIN = parseFloat(process.env.TEMP_MIN || "20");
const TEMP_MAX = parseFloat(process.env.TEMP_MAX || "25");

export const handler: APIGatewayProxyHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    // Construct the Athena query to filter for the desired partition and temperature range.
    const queryString = `
      SELECT sensorId,
             (rawTemperature - 32) * 5/9 AS temperatureC,
             rawHumidity,
             timestamp,
             objectKey
      FROM ${RAW_TABLE}
      WHERE year='${QUERY_YEAR}'
        AND month='${QUERY_MONTH}'
        AND day='${QUERY_DAY}'
        AND hour='${QUERY_HOUR}'
        AND minute='${QUERY_MINUTE}'
        AND ((rawTemperature - 32) * 5/9) BETWEEN ${TEMP_MIN} AND ${TEMP_MAX}
    `;
    console.log("Running Athena query:", queryString);

    // Start the query execution
    const startResp = await athenaClient.send(new StartQueryExecutionCommand({
      QueryString: queryString,
      QueryExecutionContext: { Database: DATABASE },
      ResultConfiguration: { OutputLocation: OUTPUT_LOCATION },
    }));

    const queryExecutionId = startResp.QueryExecutionId;
    if (!queryExecutionId) {
      throw new Error("No QueryExecutionId returned.");
    }

    // Poll until the query completes.
    let queryStatus = "RUNNING";
    while (queryStatus === "RUNNING" || queryStatus === "QUEUED") {
      const execResp = await athenaClient.send(new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }));
      queryStatus = execResp.QueryExecution?.Status?.State || "FAILED";
      if (queryStatus === "FAILED" || queryStatus === "CANCELLED") {
        throw new Error(`Athena query failed with status ${queryStatus}`);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Retrieve the results (skip header row)
    const resultsResp = await athenaClient.send(new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId }));
    const rows = resultsResp.ResultSet?.Rows || [];
    // Remove the header row
    const dataRows = rows.slice(1);
    console.log(`Athena returned ${dataRows.length} rows`);

    // For each row, extract the data and send it as a message to SQS.
    for (const row of dataRows) {
      const data = row.Data || [];
      const record = {
        sensorId: data[0]?.VarCharValue,
        temperatureC: data[1]?.VarCharValue,
        rawHumidity: data[2]?.VarCharValue,
        timestamp: data[3]?.VarCharValue,
        objectKey: data[4]?.VarCharValue,
      };

      await sqsClient.send(new SendMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        MessageBody: JSON.stringify(record),
      }));
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Athena query executed and matching records sent to SQS",
        queryExecutionId,
        processedRows: dataRows.length,
      }),
    };
  } catch (error: any) {
    console.error("Error running Athena query:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
```

---

## Step 5: Update Your SAM Template

Add the new function and SQS queue resource to your SAM template.

```yaml
Resources:
  # Existing resources (RawDataBucket, DataIngestFunction, DataIngestApi, etc.)

  ProcessedDataQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: ProcessedDataQueue

  AthenaQueryFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: runAthenaQuery.handler
      CodeUri: src/
      Runtime: nodejs20.x
      Environment:
        Variables:
          ATHENA_DATABASE: my_athena_database
          ATHENA_TABLE: my_raw_data_table
          ATHENA_OUTPUT_LOCATION: s3://datagonein60-rawdata/transformed/
          SQS_QUEUE_URL: !GetAtt ProcessedDataQueue.QueueUrl
          QUERY_YEAR: "2025"
          QUERY_MONTH: "02"
          QUERY_DAY: "10"
          QUERY_HOUR: "12"
          QUERY_MINUTE: "05"
          TEMP_MIN: "30"
          TEMP_MAX: "32"
      Policies:
        - Version: "2012-10-17"
          Statement:
            - Effect: Allow
              Action:
                - athena:StartQueryExecution
                - athena:GetQueryExecution
                - athena:GetQueryResults
                - athena:ListDataCatalogs,
                - athena:GetDataCatalog,
                - athena:CreateDataCatalog,
                - athena:UpdateDataCatalog,
                - athena:DeleteDataCatalog,
                - athena:GetDatabase,
                - athena:ListDatabases,
                - athena:GetTableMetadata,
                - athena:ListTableMetadata
              Resource: "*"
            - Effect: Allow
              Action:
                - sqs:SendMessage
              Resource: !GetAtt ProcessedDataQueue.Arn
            - Effect: Allow
              Action:
                - s3:ListBucket
                - s3:GetBucketLocation
              Resource: "arn:aws:s3:::datagonein60-rawdata"
            - Effect: Allow
              Action:
                - s3:PutObject
                - s3:GetObject
              Resource: "arn:aws:s3:::datagonein60-rawdata/*"
            - Effect: Allow
              Action:
                - glue:GetDatabase
                - glue:GetTable
                - glue:GetCatalog
                - glue:GetPartition
              Resource: 
                - "arn:aws:glue:us-east-1:837132623653:database/my_athena_database"
                - "arn:aws:glue:us-east-1:837132623653:catalog"
                - "arn:aws:glue:us-east-1:837132623653:table/my_athena_database/my_raw_data_table"
    Metadata:
      BuildMethod: esbuild
      BuildProperties:
        EntryPoints:
          - src/runAthenaQuery.ts
```

---

## Step 6: Deploy and Test

1. **Build Your Stack:**  
   Run:
   ```bash
   sam build --use-container
   ```

2. **Deploy Your Stack:**  
   Run:
   ```bash
   sam deploy --guided
   ```
   Fill in the necessary parameters.

3. **Set Up Athena:**  
   - In Athena, create the database:
     ```sql
     CREATE DATABASE my_athena_database;
     ```
   - Create the table (see Step 2 above) pointing to `s3://datagonein60-rawdata/raw/`.

4. **Test the Pipeline:**  
   - Ingest some sample data (using your existing ingest API).
   - Run the AthenaQueryFunction either manually (via the Lambda console) or schedule it using EventBridge.
   - Verify that matching records (i.e., those within the specified time window and temperature range) are sent to the ProcessedDataQueue.
   - Optionally, use CloudWatch logs to track the progress of the Athena query.

---

## Summary

- **Partition Data on Ingestion:**  
  Your ingestion function now saves data to S3 using a partitioned path based on timestamp.

- **Athena Table & Query:**  
  You define an Athena table partitioned by time and run a query that filters data based on a specific time partition and temperature range, converting the temperature to Celsius in the process.

- **SQS Delivery:**  
  The Athena query Lambda sends matching records to an SQS queue.

- **Integration:**  
  All resources are defined in your SAM template, and you can deploy the entire pipeline together.

This step-by-step approach should help illustrate your pipeline more clearly and meet your project’s goals. Let me know if you need further details or adjustments!