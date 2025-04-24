import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } from "@aws-sdk/client-athena";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

// AWS SDK clients
const athenaClient = new AthenaClient({});
const sqsClient = new SQSClient({});

// Configuration from environment
const DATABASE = process.env.ATHENA_DATABASE!;
const TABLE = process.env.ATHENA_TABLE!;
const OUTPUT_LOCATION = process.env.ATHENA_OUTPUT_LOCATION!;
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL!;

// Query parameters (date partitions)
const QUERY_YEAR = process.env.QUERY_YEAR!;
const QUERY_MONTH = process.env.QUERY_MONTH!;
const QUERY_DAY = process.env.QUERY_DAY!;

export const handler: APIGatewayProxyHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    // Construct Athena SQL: partition by date only
    const queryString = `
      SELECT
        sensorid,
        (rawtemperature - 32) * 5.0/9.0 AS temperatureC,
        rawhumidity,
        timestamp,
        objectkey
      FROM ${DATABASE}.${TABLE}
      WHERE year = '${QUERY_YEAR}'
        AND month = '${QUERY_MONTH}'
        AND day = '${QUERY_DAY}'
    `;
    console.log("Running Athena query:", queryString);

    // Start query execution
    const startResp = await athenaClient.send(new StartQueryExecutionCommand({
      QueryString: queryString,
      QueryExecutionContext: { Catalog: "AwsDataCatalog", Database: DATABASE },
      WorkGroup: "primary",
      ResultConfiguration: { OutputLocation: OUTPUT_LOCATION }
    }));

    const queryExecutionId = startResp.QueryExecutionId!;

    // Poll until the query completes
    let status = "RUNNING";
    while (status === "RUNNING" || status === "QUEUED") {
      const execResp = await athenaClient.send(new GetQueryExecutionCommand({
        QueryExecutionId: queryExecutionId
      }));
      status = execResp.QueryExecution?.Status?.State!;
      if (status === "FAILED" || status === "CANCELLED") {
        throw new Error(`Athena query failed: ${execResp.QueryExecution?.Status?.StateChangeReason}`);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Retrieve results
    const resultsResp = await athenaClient.send(new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId }));
    const rows = resultsResp.ResultSet?.Rows || [];
    const dataRows = rows.slice(1); // skip header
    console.log(`Athena returned ${dataRows.length} rows`);

    // Send each record to SQS
    for (const row of dataRows) {
      const cols = row.Data!;
      const record = {
        sensorid: cols[0]?.VarCharValue,
        temperatureC: cols[1]?.VarCharValue,
        rawhumidity: cols[2]?.VarCharValue,
        timestamp: cols[3]?.VarCharValue,
        objectkey: cols[4]?.VarCharValue
      };
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        MessageBody: JSON.stringify(record)
      }));
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Query executed and messages sent to SQS",
        queryExecutionId,
        processedRows: dataRows.length
      })
    };
  } catch (error: any) {
    console.error("Error in AthenaQueryFunction:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};