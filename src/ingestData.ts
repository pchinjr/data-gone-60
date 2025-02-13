// src/ingestData.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";

/**
 * Factory function that creates a Lambda handler.
 * This version explicitly returns a function that always returns a Promise<APIGatewayProxyResult>.
 *
 * @param s3Client Optional S3 client to inject (for testing)
 * @returns A Lambda handler function
 */
export const createHandler = (
  s3Client?: S3Client
): (event: APIGatewayProxyEvent, context: any, callback: any) => Promise<APIGatewayProxyResult> => {
  // Use the injected client if available; otherwise, create a new one.
  const client = s3Client ?? new S3Client({});

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const BUCKET_NAME = process.env.BUCKET_NAME!;
    let requestBody: any;

    // Attempt to parse the incoming JSON.
    try {
      requestBody = event.body ? JSON.parse(event.body) : {};
    } catch (parseError: any) {
      console.error("Error parsing JSON:", parseError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Invalid JSON format" }),
      };
    }

    try {
      // Extract the timestamp from the payload; if not provided, use the current time.
      const timestampStr = requestBody.timestamp;
      const date = timestampStr ? new Date(timestampStr) : new Date();

      // Build partition keys (using UTC)
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      const hour = String(date.getUTCHours()).padStart(2, '0');
      const minute = String(date.getUTCMinutes()).padStart(2, '0');

      // Construct an S3 object key using a partitioned path
      const objectKey = `raw/${year}/${month}/${day}/${hour}/${minute}/${uuidv4()}.json`;

      // Put the JSON data into the S3 bucket at the partitioned location
      await client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: objectKey,
        Body: JSON.stringify(requestBody),
      }));

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Data successfully ingested",
          objectKey,
        }),
      };
    } catch (error: any) {
      console.error("Error ingesting data:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: error.message }),
      };
    }
  };
};

// Export a default handler that creates its own S3 client.
export const handler = createHandler();