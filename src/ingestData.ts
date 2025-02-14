import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";

const s3Client = new S3Client({});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const BUCKET_NAME = process.env.BUCKET_NAME!;
  
  // Parse the JSON body; return a 400 error if parsing fails.
  let requestBody;
  try {
    requestBody = event.body ? JSON.parse(event.body) : {};
  } catch (error: any) {
    console.error("Invalid JSON:", error);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON format" }),
    };
  }
  
  // Use the provided timestamp or fallback to the current time.
  const date = requestBody.timestamp ? new Date(requestBody.timestamp) : new Date();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");

  // Construct a partitioned S3 object key.
  const objectKey = `raw/${year}/${month}/${day}/${hour}/${minute}/${uuidv4()}.json`;

  // Enrich the payload by injecting the computed objectKey.
  const enrichedPayload = { ...requestBody, objectKey };

  try {
    // Write the enriched payload to S3.
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
      Body: JSON.stringify(enrichedPayload),
    }));
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Data successfully ingested",
        objectKey,
      }),
    };
  } catch (error: any) {
    console.error("Error writing to S3:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};