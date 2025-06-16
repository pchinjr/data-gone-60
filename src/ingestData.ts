// src/ingestData.ts

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import * as AWSXRay from "aws-xray-sdk-core";

// Enable debug logging for X-Ray
AWSXRay.setContextMissingStrategy("LOG_ERROR");

// Create a segment explicitly
const s3Client = AWSXRay.captureAWSv3Client(new S3Client({}));

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log("X-Ray trace ID:", process.env._X_AMZN_TRACE_ID || "Not available");
  
  const BUCKET_NAME = process.env.BUCKET_NAME!;
  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Request body is required" }),
    };
  }

  // Parse incoming payload (array of records or single object)
  let payload: any;
  try {
    payload = JSON.parse(event.body);
  } catch (err: any) {
    console.error("Invalid JSON:", err);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON format" }),
    };
  }
  const records = Array.isArray(payload) ? payload : [payload];

  // Create a custom subsegment for processing
  const segment = AWSXRay.getSegment();
  const subsegment = segment?.addNewSubsegment('process-records');
  
  try {
    // Derive date partition (year/month/day) from first record's timestamp
    const tsString = records[0]?.timestamp;
    const ts = tsString ? new Date(tsString) : new Date();
    const year  = ts.getUTCFullYear().toString();
    const month = String(ts.getUTCMonth() + 1).padStart(2, "0");
    const day   = String(ts.getUTCDate()).padStart(2, "0");

    // Build S3 key and body (newline-delimited JSON)
    const batchId = uuidv4();
    const objectKey = `raw/year=${year}/month=${month}/day=${day}/${batchId}.json`;
    const fileBody = records
      .map(r => JSON.stringify({ ...r, objectKey }))
      .join("\n");

    subsegment?.addAnnotation('recordCount', records.length);
    subsegment?.addAnnotation('year', year);
    subsegment?.addAnnotation('month', month);
    subsegment?.addAnnotation('day', day);
    subsegment?.close();

    // Upload to S3
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: objectKey,
          Body: fileBody,
          ContentType: "application/json",
        })
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `Wrote ${records.length} records to S3`,
          objectKey,
        }),
      };
    } catch (err: any) {
      console.error("Error writing to S3:", err);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: err.message }),
      };
    }
  } catch (error) {
    if (subsegment) {
      subsegment.addError(error);
      subsegment.close();
    }
    throw error;
  }
};