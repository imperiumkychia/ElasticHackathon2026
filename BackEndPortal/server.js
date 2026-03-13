import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const {
  PORT = 3003,
  AWS_REGION = "ap-southeast-1",
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  CLINICS_TABLE,
  PATIENTS_TABLE,
  APPOINTMENTS_TABLE,
} = process.env;

if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
  console.warn("Missing AWS credentials in env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY");
}
if (!CLINICS_TABLE || !PATIENTS_TABLE || !APPOINTMENTS_TABLE) {
  console.warn("Missing table names in env: CLINICS_TABLE, PATIENTS_TABLE, APPOINTMENTS_TABLE");
}

const client = new DynamoDBClient({
  region: AWS_REGION,
  credentials: AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

function normalizeStatus(status) {
  if (typeof status !== "string") return "Upcoming";
  const trimmed = status.trim();
  if (!trimmed) return "Upcoming";
  const lower = trimmed.toLowerCase();
  if (lower === "completed") return "Completed";
  if (lower === "upcoming") return "Upcoming";
  return trimmed;
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/clinics", async (req, res) => {
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: CLINICS_TABLE,
      })
    );
    res.json({ items: result.Items || [] });
  } catch (err) {
    console.error("[CLINICS] scan error", err);
    res.status(500).json({ error: "Failed to fetch clinics" });
  }
});

app.get("/api/patients", async (req, res) => {
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: PATIENTS_TABLE,
      })
    );
    res.json({ items: result.Items || [] });
  } catch (err) {
    console.error("[PATIENTS] scan error", err);
    res.status(500).json({ error: "Failed to fetch patients" });
  }
});

app.get("/api/appointments", async (req, res) => {
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: APPOINTMENTS_TABLE,
      })
    );
    const items = (result.Items || []).map((item) => ({
      ...item,
      status: normalizeStatus(item?.status),
    }));
    res.json({ items });
  } catch (err) {
    console.error("[APPOINTMENTS] scan error", err);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
});

app.patch("/api/appointments/:appointmentId", async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { date, status } = req.body || {};

    if (!appointmentId || !date || typeof status !== "string") {
      return res.status(400).json({ error: "appointmentId, date, and status are required" });
    }

    const normalized = normalizeStatus(status);
    const result = await ddb.send(
      new UpdateCommand({
        TableName: APPOINTMENTS_TABLE,
        Key: { appointmentId, date },
        UpdateExpression: "SET #status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": normalized },
        ReturnValues: "ALL_NEW",
      })
    );

    res.json({ item: result.Attributes || null });
  } catch (err) {
    console.error("[APPOINTMENTS] update error", err);
    res.status(500).json({ error: "Failed to update appointment status" });
  }
});

app.get("/api/appointments/:appointmentId", async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { date } = req.query;
    if (!appointmentId || !date) {
      return res.status(400).json({ error: "appointmentId and date are required" });
    }

    const result = await ddb.send(
      new GetCommand({
        TableName: APPOINTMENTS_TABLE,
        Key: { appointmentId, date },
      })
    );

    res.json({ item: result.Item || null });
  } catch (err) {
    console.error("[APPOINTMENTS] get error", err);
    res.status(500).json({ error: "Failed to fetch appointment" });
  }
});

app.listen(Number(PORT), () => {
  console.log(`Portal backend listening on port ${PORT}`);
});
