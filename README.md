# Executive Summary

Accessing healthcare can be frustrating for both patients and clinics. Patients often struggle to understand their symptoms, determine the right type of care, and book appointments through outdated processes such as phone calls or manual forms. At the same time, clinics spend significant time managing triage, scheduling, and appointment coordination, often without clear visibility into patient urgency or demand.

We propose building a medical assistant application that leverages **AI and cloud services** to streamline symptom triage, appointment booking, and provider preparation. Using **ElasticSearch and AWS AI services** (embeddings, LLM tools, and agent-based workflows), the system guides patients through symptom-based questions, identifies potential urgency or red-flag cases, and recommends the most appropriate care option.

The assistant can automatically recommend available providers and appointment slots, while generating a structured summary of the patient’s symptoms and context. This summary is shared with clinicians ahead of the visit, allowing them to prepare diagnostics or next steps before the patient arrives. The system also supports automated reminders and scheduling management.

This idea demonstrates how AI-powered triage and intelligent scheduling can improve patient access to care, reduce administrative workload for clinics, and enable more efficient, prepared consultations.

---

# Simple Proposal

## Problem
1. Patients struggle to identify possible illnesses, determine the appropriate type of visit, and find the right provider.  
2. Appointment booking is inconvenient and outdated, often requiring phone calls and repeated information, leading to missed visits and frustration.  
3. Clinics spend excessive time on manual triage, scheduling, rescheduling, and reminders, with limited visibility into urgency and demand.

## Proposed Solution
We propose an **AI-powered medical assistant application** that improves patient triage and appointment management.

1. An AI assistant guides patients through symptom-based questions to perform **preliminary triage**, including identifying urgent or red-flag symptoms.  
2. The assistant summarizes possible conditions, recommends the appropriate visit type (e.g., GP, specialist, telehealth), and suggests **available appointment slots**.  
3. Once booked, the system generates a **structured triage summary** that is shared with clinicians so they can prepare tests, diagnostics, and next steps in advance. Automated reminders help reduce missed appointments.

## Prototype Approach
The prototype will be built using the following technologies:

- **ElasticSearch** for medical knowledge retrieval and symptom search  
- **AWS AI services** for embeddings, LLM-based reasoning, and agent workflows  
- **LLM tools** to generate symptom summaries and triage recommendations  
- **User interface** for patients to interact with the assistant and book appointments

## Expected Outcomes
- Faster and easier access to appropriate healthcare services for patients  
- Reduced administrative workload for clinics  
- Better prepared consultations through structured triage summaries  
- Improved scheduling efficiency and reduced no-show rates

Monorepo for an **Imperium Medical Triage Assistant** demo with:
- chat assistant UI + backend connected to Elastic A2A
- clinic portal UI + backend connected to DynamoDB
- MCP server exposing clinic/patient/appointment tools over HTTP

## Technical Section ##
## Project Summary

This project is a multi-service healthcare assistant prototype built for hackathon use. It combines:
- an AI triage chat experience (`Frontend` + `Backend`) that routes user messages to an Elastic A2A agent
- an operational clinic portal (`FrontEndPortal` + `BackEndPortal`) for viewing clinics, patients, and appointments
- an MCP integration layer (`BackEndMCP`) that exposes DynamoDB-backed healthcare data as callable tools for AI workflows

Together, these services demonstrate how conversational triage, structured medical operations data, and tool-augmented AI can run as one end-to-end system.

## Integration Summary

This project also integrates **Elastic**, an **MCP server**, **Twilio**, and **ElevenLabs** for a phone-call use case.

- Twilio handles the call channel.
- ElevenLabs provides voice interaction.
- Elastic provides indexed knowledge retrieval.
- The MCP server provides tool access to clinic data and workflows.

Through this architecture, the agent can complete end-to-end actions during a call, including:
- retrieving database data
- querying Elastic indexes
- managing appointments (view/update flow)

All of these are orchestrated by the agent in one conversation flow.

## Repository Structure

- `Frontend/` - React + Vite chat UI (`elastic-agent-frontend`)
- `Backend/` - Express API for chat/A2A relay (`elastic-agent-backend`)
- `FrontEndPortal/` - React + Vite clinic portal UI (`clinic-appointment-portal`)
- `BackEndPortal/` - Express + DynamoDB clinic portal API (`clinic-portal-backend`)
- `BackEndMCP/` - MCP HTTP server + DynamoDB tools (`clinic-mcp-server`)

## Prerequisites

- Node.js 18+
- npm
- Elastic Kibana endpoint + Agent ID + API key (for `Backend`)
- AWS credentials + DynamoDB tables (for `BackEndPortal` and `BackEndMCP`)

## Environment Setup

Copy each example env file and fill in real values:

```bash
cp Frontend/.env.example Frontend/.env
cp Backend/.env.example Backend/.env
cp FrontEndPortal/.env.example FrontEndPortal/.env
cp BackEndPortal/.env.example BackEndPortal/.env
cp BackEndMCP/.env.example BackEndMCP/.env
```

### Key Variables

`Frontend/.env`
- `VITE_BACKEND_URL` (default: `http://localhost:3001`)

`Backend/.env`
- `PORT` (default: `3001`)
- `KIBANA_URL`
- `AGENT_ID`
- `API_KEY`
- `A2A_METHOD` (default: `message/send`)
- `POLL_INTERVAL_MS` (default: `1000`)
- `MAX_POLL_ATTEMPTS` (default: `20`)

`FrontEndPortal/.env`
- `VITE_PORTAL_API` (default: `http://localhost:3003`)

`BackEndPortal/.env`
- `PORT` (default: `3003`)
- `AWS_REGION` (default: `ap-southeast-1`)
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `CLINICS_TABLE`
- `PATIENTS_TABLE`
- `APPOINTMENTS_TABLE`

`BackEndMCP/.env`
- `PORT` (default: `3004`)
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `CLINICS_TABLE`
- `PATIENTS_TABLE`
- `APPOINTMENTS_TABLE`
- `GSI_PATIENT_ID` (default: `GSI_PatientId`)
- `GSI_CLINIC_ID` (default: `GSI_ClinicId`)

## Install Dependencies

Run in each package directory:

```bash
cd Frontend && npm install
cd ../Backend && npm install
cd ../FrontEndPortal && npm install
cd ../BackEndPortal && npm install
cd ../BackEndMCP && npm install
```

## Run the Applications

Start each service in its own terminal:

```bash
# Terminal 1
cd Backend && npm run dev

# Terminal 2
cd Frontend && npm run dev

# Terminal 3
cd BackEndPortal && npm run dev

# Terminal 4
cd FrontEndPortal && npm run dev

# Terminal 5
cd BackEndMCP && npm start
```

## Default Local Ports

- `Frontend`: Vite dev server (typically `5173`)
- `Backend`: `3001`
- `FrontEndPortal`: Vite dev server (typically `5174` if `5173` is occupied)
- `BackEndPortal`: `3003`
- `BackEndMCP`: `3004`

## API Endpoints

### Backend (`Backend`)
- `GET /health`
- `POST /api/chat`

### Portal Backend (`BackEndPortal`)
- `GET /health`
- `GET /api/clinics`
- `GET /api/patients`
- `GET /api/appointments`
- `GET /api/appointments/:appointmentId?date=YYYY-MM-DD`
- `PATCH /api/appointments/:appointmentId`

### MCP Server (`BackEndMCP`)
- `GET /health`
- `POST /mcp`
- `POST /`

Registered MCP tools include:
- `list_clinics`
- `list_patients`
- `list_appointments`
- `get_patient_history`
- `list_clinic_appointments`
- `create_patient`
- `create_appointment`
- `update_appointment_status`

## Notes

- `BackEndPortal` and `BackEndMCP` require DynamoDB tables and expected key/index design.
- `Backend` requires valid Elastic A2A credentials/config to return assistant responses.
