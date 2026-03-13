import dotenv from "dotenv";
import express from "express";
import { z } from "zod";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));

// DynamoDB configuration with safer defaults
const {
  PORT = 3004,
  AWS_REGION = "ap-southeast-1",
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  CLINICS_TABLE,
  PATIENTS_TABLE,
  APPOINTMENTS_TABLE,
  GSI_PATIENT_ID = "GSI_PatientId",
  GSI_CLINIC_ID = "GSI_ClinicId",
} = process.env;

if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
  console.warn("Missing AWS credentials in env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY");
}
if (!CLINICS_TABLE || !PATIENTS_TABLE || !APPOINTMENTS_TABLE) {
  console.warn("Missing table names in env: CLINICS_TABLE, PATIENTS_TABLE, APPOINTMENTS_TABLE");
}

// DynamoDB client with credentials and consistent read preference
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: AWS_REGION,
    credentials: AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
      ? { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
      : undefined,
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);

// Safe pagination configuration to prevent unbounded scans
const PAGINATION_PAGE_SIZE = 25; // AWS recommends max 25 for ScanCommand in MCP context
const QUERY_MAX_LIMIT = 100; // Cap query limits even if configured higher

function createStructuredLogger() {
  const logger = {
    info: (category, message, meta) => {
      console.log(`[${category}]`, { timestamp: Date.now(), ...message, ...meta });
    },
    error: (category, message, meta) => {
      console.error(`[${category} ERROR]`, { timestamp: Date.now(), ...message, ...meta });
    },
  };
  return logger;
}

const logger = createStructuredLogger();

function jsonResponse(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function createServer() {
  const server = new McpServer({ name: "clinic-dynamodb-mcp", version: "0.2.0" });

  server.registerTool("list_clinics", { description: "List all clinics." }, async () => {
    logger.info("CLINICS", { action: "scan initiated" });

    // Paginate through results to avoid hot partitions and excessive scans
    let items = [];
    let lastEvaluatedKey;

    do {
      const command = new ScanCommand({
        TableName: CLINICS_TABLE,
        Limit: PAGINATION_PAGE_SIZE,
        ExclusiveStartKey: lastEvaluatedKey,
      });
      const result = await ddb.send(command);

      if (result.Items) {
        items.push(...result.Items);
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey && items.length < 100); // Cap at 100 for safety

    logger.info("CLINICS", { action: "scan completed", total: items.length });
    return jsonResponse({ items, total: items.length });
  });

  server.registerTool("list_patients", { description: "List all patients." }, async () => {
    logger.info("PATIENTS", { action: "scan initiated" });

    let items = [];
    let lastEvaluatedKey;

    do {
      const command = new ScanCommand({
        TableName: PATIENTS_TABLE,
        Limit: PAGINATION_PAGE_SIZE,
        ExclusiveStartKey: lastEvaluatedKey,
      });
      const result = await ddb.send(command);

      if (result.Items) {
        items.push(...result.Items);
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey && items.length < 100); // Cap at 100 for safety

    logger.info("PATIENTS", { action: "scan completed", total: items.length });
    return jsonResponse({ items, total: items.length });
  });

  server.registerTool("list_appointments", { description: "List all appointments." }, async () => {
    logger.info("APPOINTMENTS", { action: "scan initiated" });

    let items = [];
    let lastEvaluatedKey;

    do {
      const command = new ScanCommand({
        TableName: APPOINTMENTS_TABLE,
        Limit: PAGINATION_PAGE_SIZE,
        ExclusiveStartKey: lastEvaluatedKey,
      });
      const result = await ddb.send(command);

      if (result.Items) {
        items.push(...result.Items);
      }

      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey && items.length < 100); // Cap at 100 for safety

    logger.info("APPOINTMENTS", { action: "scan completed", total: items.length });
    return jsonResponse({ items, total: items.length });
  });

  server.registerTool(
    "get_patient_history",
    {
      description: "Get appointment history for a patient using the patientId GSI.",
      inputSchema: z.object({
        patientId: z.string().min(1),
        limit: z.number().int().min(1).max(QUERY_MAX_LIMIT).optional(),
      }),
    },
    async ({ patientId, limit }) => {
      logger.info("PATIENT_HISTORY", { patientId, limitLimit: limit || QUERY_MAX_LIMIT });

      try {
        const queryResult = await ddb.send(
          new QueryCommand({
            TableName: APPOINTMENTS_TABLE,
            IndexName: GSI_PATIENT_ID,
            KeyConditionExpression: "patientId = :pid",
            ExpressionAttributeValues: { ":pid": patientId },
            Limit: limit || QUERY_MAX_LIMIT,
            ConsistentRead: true, // Ensure consistent reads for data integrity
          })
        );

        const items = queryResult.Items || [];
        logger.info("PATIENT_HISTORY", { action: "query completed", itemCount: items.length });

        return jsonResponse({ items, total: items.length });
      } catch (err) {
        logger.error("PATIENT_HISTORY", { error: err.message, code: err.code });
        throw err; // Re-throw so MCP client sees the error
      }
    }
  );

  server.registerTool(
    "list_clinic_appointments",
    {
      description: "Get appointments for a clinic using the clinicId GSI.",
      inputSchema: z.object({
        clinicId: z.string().min(1),
        limit: z.number().int().min(1).max(QUERY_MAX_LIMIT).optional(),
      }),
    },
    async ({ clinicId, limit }) => {
      logger.info("CLINIC_APPOINTMENTS", { clinicId, limit: limit || QUERY_MAX_LIMIT });

      try {
        const queryResult = await ddb.send(
          new QueryCommand({
            TableName: APPOINTMENTS_TABLE,
            IndexName: GSI_CLINIC_ID,
            KeyConditionExpression: "clinicId = :cid",
            ExpressionAttributeValues: { ":cid": clinicId },
            Limit: limit || QUERY_MAX_LIMIT,
            ConsistentRead: true, // Ensure consistent reads for data integrity
          })
        );

        const items = queryResult.Items || [];
        logger.info("CLINIC_APPOINTMENTS", { action: "query completed", itemCount: items.length });

        return jsonResponse({ items, total: items.length });
      } catch (err) {
        logger.error("CLINIC_APPOINTMENTS", { error: err.message, code: err.code });
        throw err; // Re-throw so MCP client sees the error
      }
    }
  );

  server.registerTool(
    "create_patient",
    {
      description: "Create a patient record. Only required fields will be persisted.",
      inputSchema: z.object({
        patientId: z.string().min(1),
        name: z.string().min(1),
        ic: z.string().optional(),
        phone: z.string().optional(),
        notes: z.string().optional(),
      }),
    },
    async (input) => {
      // Remove any potentially sensitive fields before storage
      const safeItem = {
        patientId: input.patientId,
        name: input.name,
        ...(input.ic && { ic: input.ic }),
        ...(input.phone && { phone: input.phone }),
        ...(input.notes && { notes: input.notes }),
      };

      logger.info("CREATE_PATIENT", { patientId: input.patientId });

      try {
        await ddb.send(new PutCommand({ TableName: PATIENTS_TABLE, Item: safeItem }));
        logger.info("CREATE_PATIENT", { action: "created successfully" });
        return jsonResponse({ item: safeItem });
      } catch (err) {
        logger.error("CREATE_PATIENT", { error: err.message, code: err.code });
        throw err; // Re-throw so MCP client sees the error
      }
    }
  );

  server.registerTool(
    "create_appointment",
    {
      description:
        "Create an appointment record. Required: appointmentId, date, patientId, clinicId. Optional: time, status, summary.",
      inputSchema: z.object({
        appointmentId: z.string().min(1),
        date: z.string().min(1),
        time: z.string().optional(),
        status: z.string().optional(),
        summary: z.string().optional(),
        patientId: z.string().min(1),
        clinicId: z.string().min(1),
      }),
    },
    async (input) => {
      const safeItem = {
        appointmentId: input.appointmentId,
        date: input.date,
        time: input.time || "",
        status: input.status || "Upcoming",
        summary: input.summary || "",
        patientId: input.patientId,
        clinicId: input.clinicId,
      };

      logger.info("CREATE_APPOINTMENT", {
        appointmentId: input.appointmentId,
        date: input.date,
      });

      try {
        await ddb.send(new PutCommand({ TableName: APPOINTMENTS_TABLE, Item: safeItem }));
        logger.info("CREATE_APPOINTMENT", { action: "created successfully" });
        return jsonResponse({ item: safeItem });
      } catch (err) {
        // Check for capacity exceeded error
        if (err.code === "PROVISIONEDthroughputExceededException") {
          logger.error("CREATE_APPOINTMENT", { error: "DynamoDB table at capacity limit" });
          throw new Error("Table is at its write capacity limit. Please upgrade or use on-demand capacity.");
        }
        logger.error("CREATE_APPOINTMENT", { error: err.message, code: err.code });
        throw err; // Re-throw so MCP client sees the error
      }
    }
  );

  server.registerTool(
    "update_appointment_status",
    {
      description: "Update appointment status by appointmentId + date.",
      inputSchema: z.object({
        appointmentId: z.string().min(1),
        date: z.string().min(1),
        status: z.string().min(1).optional(),
      }),
    },
    async ({ appointmentId, date, status }) => {
      // Ensure status is valid
      const normalizedStatus = status ? (status.toLowerCase() === "completed" ? "Completed" : "Upcoming") : undefined;

      logger.info("UPDATE_APPOINTMENT", {
        appointmentId,
        date,
        previousStatus: status,
        newStatus: normalizedStatus,
      });

      try {
        const result = await ddb.send(
          new UpdateCommand({
            TableName: APPOINTMENTS_TABLE,
            Key: { appointmentId, date },
            UpdateExpression: "SET #status = :status",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: normalizedStatus
              ? { ":status": normalizedStatus }
              : { ":status": "Upcoming" }, // Default to upcoming if not specified
            ReturnValues: "ALL_NEW",
          })
        );

        const item = result.Attributes || null;
        logger.info("UPDATE_APPOINTMENT", { action: "updated successfully", newStatus: item?.status });

        return jsonResponse({ item });
      } catch (err) {
        logger.error("UPDATE_APPOINTMENT", { error: err.message, code: err.code });
        throw err; // Re-throw so MCP client sees the error
      }
    }
  );

  return server;
}

async function handleMcp(req, res) {
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", async () => {
      await transport.close();
      await server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[MCP] request error", err);
    res.status(500).json({ error: err.message || "MCP error" });
  }
}

app.post("/mcp", handleMcp);
app.post("/", handleMcp);

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`MCP HTTP server listening on port ${PORT}`);
});
