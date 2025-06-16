import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } from "@aws-sdk/client-athena";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import * as AWSXRay from "aws-xray-sdk-core";

// Enable debug logging for X-Ray
AWSXRay.setContextMissingStrategy("LOG_ERROR");

// AWS SDK clients
const athenaClient = AWSXRay.captureAWSv3Client(new AthenaClient({}));
const sqsClient = AWSXRay.captureAWSv3Client(new SQSClient({}));

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
  console.log("X-Ray trace ID:", process.env._X_AMZN_TRACE_ID || "Not available");
  
  try {
    // Create a custom subsegment for query preparation
    const segment = AWSXRay.getSegment();
    const queryPrepSubsegment = segment?.addNewSubsegment('prepare-athena-query');
    
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
    
    if (queryPrepSubsegment) {
      queryPrepSubsegment.addAnnotation('year', QUERY_YEAR);
      queryPrepSubsegment.addAnnotation('month', QUERY_MONTH);
      queryPrepSubsegment.addAnnotation('day', QUERY_DAY);
      queryPrepSubsegment.close();
    }

    // Start query execution
    const startResp = await athenaClient.send(new StartQueryExecutionCommand({
      QueryString: queryString,
      QueryExecutionContext: { Catalog: "AwsDataCatalog", Database: DATABASE },
      WorkGroup: "primary",
      ResultConfiguration: { OutputLocation: OUTPUT_LOCATION }
    }));

    const queryExecutionId = startResp.QueryExecutionId!;

    // Create a subsegment for query polling
    const pollSubsegment = segment?.addNewSubsegment('poll-athena-query');
    
    // Poll until the query completes
    let status = "RUNNING";
    while (status === "RUNNING" || status === "QUEUED") {
      const execResp = await athenaClient.send(new GetQueryExecutionCommand({
        QueryExecutionId: queryExecutionId
      }));
      status = execResp.QueryExecution?.Status?.State!;
      if (status === "FAILED" || status === "CANCELLED") {
        if (pollSubsegment) {
          pollSubsegment.addError(new Error(`Athena query failed: ${execResp.QueryExecution?.Status?.StateChangeReason}`));
          pollSubsegment.close();
        }
        throw new Error(`Athena query failed: ${execResp.QueryExecution?.Status?.StateChangeReason}`);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    if (pollSubsegment) {
      pollSubsegment.addAnnotation('queryStatus', status);
      pollSubsegment.close();
    }

    // Create a subsegment for processing results
    const resultsSubsegment = segment?.addNewSubsegment('process-athena-results');
    
    // Retrieve results
    const resultsResp = await athenaClient.send(new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId }));
    const rows = resultsResp.ResultSet?.Rows || [];
    const dataRows = rows.slice(1); // skip header
    console.log(`Athena returned ${dataRows.length} rows`);
    
    if (resultsSubsegment) {
      resultsSubsegment.addAnnotation('rowCount', dataRows.length);
      resultsSubsegment.close();
    }

    // Create a subsegment for SQS operations
    const sqsSubsegment = segment?.addNewSubsegment('send-to-sqs');
    
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
    
    if (sqsSubsegment) {
      sqsSubsegment.addAnnotation('messagesSent', dataRows.length);
      sqsSubsegment.close();
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