// src/ingestData.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

// Create an S3 client instance (uses credentials from the environment)
const s3Client = new S3Client({});
// Retrieve the bucket name from environment variables
const BUCKET_NAME = process.env.BUCKET_NAME!;

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    console.log("Received event:", JSON.stringify(event));

    // Parse the JSON body (assuming it's an array or object)
    const requestBody = event.body ? JSON.parse(event.body) : {};

    // Generate a unique key for storing the data in S3
    const objectKey = `raw/${uuidv4()}.json`;

    // Put the JSON data into the S3 bucket
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
      Body: JSON.stringify(requestBody)
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Data successfully ingested",
        objectKey
      })
    };
  } catch (error: any) {
    console.error("Error ingesting data:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};
