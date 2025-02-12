// __tests__/ingestData.test.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHandler } from "../src/ingestData";

describe("ingestData Lambda Function", () => {
  let sendMock: jest.Mock;
  let fakeS3Client: { send: jest.Mock };
  let testHandler: (event: APIGatewayProxyEvent, context: any, callback: any) => Promise<APIGatewayProxyResult>;

  beforeEach(() => {
    // Set up a fake S3 client with a mocked send method.
    sendMock = jest.fn();
    fakeS3Client = { send: sendMock };
    process.env.BUCKET_NAME = "datagonein60-rawdata";

    // Create the handler by injecting the fake S3 client.
    testHandler = createHandler(fakeS3Client as unknown as  S3Client);
  });

  it("should successfully ingest data and return a 200 response", async () => {
    // Arrange: Create a fake API Gateway event with valid JSON body.
    const testData = {
      sensorId: "S123",
      rawTemperature: 85,
      rawHumidity: 55,
      timestamp: "2025-02-10T12:00:00Z",
    };

    const event: APIGatewayProxyEvent = {
      body: JSON.stringify(testData),
      headers: {},
      multiValueHeaders: {},
      httpMethod: "POST",
      isBase64Encoded: false,
      path: "/ingest",
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: "",
    };

    // Simulate a successful S3 operation.
    sendMock.mockResolvedValueOnce({});

    // Act: Invoke the Lambda handler.
    const result = await testHandler(event, {} as any, () => {}) as APIGatewayProxyResult;

    // Assert: Check that the response is 200 and includes the expected message.
    expect(result.statusCode).toBe(200);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.message).toBe("Data successfully ingested");
    expect(typeof responseBody.objectKey).toBe("string");

    // Verify that the S3 client's send method was called once with a PutObjectCommand.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const calledCommand = sendMock.mock.calls[0][0];
    expect(calledCommand).toBeInstanceOf(PutObjectCommand);
    expect(calledCommand.input.Bucket).toEqual("datagonein60-rawdata");
  });

  it("should return a 500 error when the request body is invalid", async () => {
    // Arrange: Create a fake event with an invalid (non-JSON) body.
    const event: APIGatewayProxyEvent = {
      body: "invalid-json",
      headers: {},
      multiValueHeaders: {},
      httpMethod: "POST",
      isBase64Encoded: false,
      path: "/ingest",
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: "",
    };

    // Act: Invoke the Lambda handler.
    const result = await testHandler(event, {} as any, () => {}) as APIGatewayProxyResult;

    // Assert: The response should have a 500 status code and include an error message.
    expect(result.statusCode).toBe(500);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.error).toBeDefined();
  });
});
