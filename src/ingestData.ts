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
    try {
      console.log("Received event:", JSON.stringify(event));

      // Parse the JSON body (assuming it's an object)
      const requestBody = event.body ? JSON.parse(event.body) : {};

      // Generate a unique key for storing the data in S3
      const objectKey = `raw/${uuidv4()}.json`;

      // Put the JSON data into the S3 bucket
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
        body: JSON.stringify({
          error: error.message,
        }),
      };
    }
  };
};

// Export a default handler that creates its own S3 client.
export const handler = createHandler();