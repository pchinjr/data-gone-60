import { APIGatewayProxyResult } from "aws-lambda";

// Declare our mocks before anything else.
const mockAthenaSend = jest.fn();
const mockSQSSend = jest.fn();

// Mock the Athena client.
jest.mock("@aws-sdk/client-athena", () => {
  const actual = jest.requireActual("@aws-sdk/client-athena");
  return {
    ...actual,
    AthenaClient: jest.fn(() => ({
      send: mockAthenaSend,
    })),
  };
});

// Mock the SQS client.
jest.mock("@aws-sdk/client-sqs", () => {
  const actual = jest.requireActual("@aws-sdk/client-sqs");
  return {
    ...actual,
    SQSClient: jest.fn(() => ({
      send: mockSQSSend,
    })),
  };
});

let handler: (event: any, context: any, callback: any) => Promise<APIGatewayProxyResult>;

beforeAll(async () => {
  // Import the handler dynamically after mocks are set up.
  const module = await import("../src/runAthenaQuery");
   // Cast the handler to ensure it always returns a Promise<APIGatewayProxyResult>
   handler = module.handler as unknown as (event: any, context: any, callback: any) => Promise<APIGatewayProxyResult>;
});

describe("AthenaQueryFunction", () => {
  beforeEach(() => {
    // Clear mock call history.
    mockAthenaSend.mockClear();
    mockSQSSend.mockClear();

    // Set up environment variables needed by the function.
    process.env.ATHENA_DATABASE = "my_athena_database";
    process.env.ATHENA_TABLE = "my_raw_data_table";
    process.env.ATHENA_OUTPUT_LOCATION = "s3://datagonein60-rawdata/transformed/";
    process.env.SQS_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/ProcessedDataQueue";
    process.env.QUERY_YEAR = "2025";
    process.env.QUERY_MONTH = "02";
    process.env.QUERY_DAY = "10";
    process.env.QUERY_HOUR = "12";
    process.env.QUERY_MINUTE = "05";
    process.env.TEMP_MIN = "30";
    process.env.TEMP_MAX = "32";
  });

  it("should execute Athena query successfully and send messages to SQS", async () => {
    // Arrange:
    // 1. StartQueryExecution returns a queryExecutionId.
    mockAthenaSend.mockResolvedValueOnce({ QueryExecutionId: "query123" });
    
    // 2. GetQueryExecution returns a SUCCEEDED status.
    mockAthenaSend.mockResolvedValueOnce({
      QueryExecution: { Status: { State: "SUCCEEDED" } },
    });
    
    // 3. GetQueryResults returns a header row and two data rows.
    const headerRow = {
      Data: [
        { VarCharValue: "sensorId" },
        { VarCharValue: "temperatureC" },
        { VarCharValue: "rawHumidity" },
        { VarCharValue: "timestamp" },
        { VarCharValue: "objectKey" },
      ],
    };
    const dataRow1 = {
      Data: [
        { VarCharValue: "S101" },
        { VarCharValue: "21.11" },
        { VarCharValue: "48" },
        { VarCharValue: "2025-02-10T12:00:00Z" },
        { VarCharValue: "key1" },
      ],
    };
    const dataRow2 = {
      Data: [
        { VarCharValue: "S102" },
        { VarCharValue: "22.22" },
        { VarCharValue: "50" },
        { VarCharValue: "2025-02-10T12:05:00Z" },
        { VarCharValue: "key2" },
      ],
    };
    mockAthenaSend.mockResolvedValueOnce({
      ResultSet: {
        Rows: [headerRow, dataRow1, dataRow2],
      },
    });

    // 4. SQS send resolves successfully for each message.
    mockSQSSend.mockResolvedValue({});

    // Act: Invoke the Athena query Lambda.
    const result = (await handler({} as any, {} as any, () => {})) as APIGatewayProxyResult;

    // Assert:
    expect(result.statusCode).toBe(200);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.message).toBe("Athena query executed and matching records sent to SQS");
    expect(responseBody.processedRows).toBe(2);

    // Verify that SQS send was called twice (one for each data row).
    expect(mockSQSSend).toHaveBeenCalledTimes(2);
  });

  it("should return a 500 error if the Athena query fails", async () => {
    // Arrange:
    // 1. StartQueryExecution returns a queryExecutionId.
    mockAthenaSend.mockResolvedValueOnce({ QueryExecutionId: "query123" });
    // 2. GetQueryExecution returns a FAILED status.
    mockAthenaSend.mockResolvedValueOnce({
      QueryExecution: { Status: { State: "FAILED" } },
    });

    // Act: Invoke the handler.
    const result = (await handler({} as any, {} as any, () => {})) as APIGatewayProxyResult;

    // Assert: Expect a 500 error.
    expect(result.statusCode).toBe(500);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.error).toMatch(/failed with status FAILED/);
  });
});
