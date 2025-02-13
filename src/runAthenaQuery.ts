import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } from "@aws-sdk/client-athena";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";

const athenaClient = new AthenaClient({});
const sqsClient = new SQSClient({ region: "us-east-1" });

// Configuration from environment variables
const DATABASE = process.env.ATHENA_DATABASE || "my_athena_database";
const RAW_TABLE = process.env.ATHENA_TABLE || "my_raw_data_table";
const OUTPUT_LOCATION = process.env.ATHENA_OUTPUT_LOCATION || "s3://datagonein60-rawdata/transformed/";
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL || "https://sqs.us-east-1.amazonaws.com/837132623653/ProcessedDataQueue";
// Query parameters for the time window and temperature range
const QUERY_YEAR = process.env.QUERY_YEAR || "2025";
const QUERY_MONTH = process.env.QUERY_MONTH || "02";
const QUERY_DAY = process.env.QUERY_DAY || "10";
const QUERY_HOUR = process.env.QUERY_HOUR || "12";
const QUERY_MINUTE = process.env.QUERY_MINUTE || "05";
const TEMP_MIN = parseFloat(process.env.TEMP_MIN || "30");
const TEMP_MAX = parseFloat(process.env.TEMP_MAX || "32");

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
