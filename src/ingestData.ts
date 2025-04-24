// src/ingestData.ts

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";

const s3Client = new S3Client({});

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
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
};
