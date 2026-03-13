import React, { useMemo, useState, useEffect } from "react";

const API_BASE = import.meta.env.VITE_PORTAL_API || "http://localhost:3003";
const DEFAULT_STATUS = "Upcoming";

function formatDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatTime(time) {
  return new Date(`1970-01-01T${time}:00`).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeStatus(status) {
  if (typeof status !== "string") return DEFAULT_STATUS;
  const trimmed = status.trim();
  if (!trimmed) return DEFAULT_STATUS;

  const lower = trimmed.toLowerCase();
  if (lower === "completed") return "Completed";
  if (lower === "upcoming") return "Upcoming";
  return trimmed;
}

function getStatusClass(status) {
  return normalizeStatus(status).toLowerCase().replace(/\s+/g, "-");
}

export default function App() {
  const [clinics, setClinics] = useState([]);
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedClinicId, setSelectedClinicId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    async function loadAll() {
      try {
        setLoading(true);
        setError("");
        const [clinicsRes, patientsRes, apptsRes] = await Promise.all([
          fetch(`${API_BASE}/api/clinics`),
          fetch(`${API_BASE}/api/patients`),
          fetch(`${API_BASE}/api/appointments`),
        ]);

        const clinicsData = await clinicsRes.json();
        const patientsData = await patientsRes.json();
        const apptsData = await apptsRes.json();

        if (!clinicsRes.ok || !patientsRes.ok || !apptsRes.ok) {
          throw new Error("Failed to load data from API");
        }

        if (!isMounted) return;
        setClinics(clinicsData.items || []);
        setPatients(patientsData.items || []);
        setAppointments(
          (apptsData.items || []).map((appt) => ({
            ...appt,
            status: normalizeStatus(appt?.status),
          }))
        );

        setSelectedClinicId((clinicsData.items || [])[0]?.clinicId || "");
        setSelectedPatientId((patientsData.items || [])[0]?.patientId || "");
      } catch (err) {
        console.error(err);
        if (isMounted) setError(err.message || "Failed to load data");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadAll();
    return () => {
      isMounted = false;
    };
  }, []);

  const patientAppointments = useMemo(
    () => appointments.filter((appt) => appt.patientId === selectedPatientId),
    [appointments, selectedPatientId]
  );

  const clinicAppointments = useMemo(
    () => appointments.filter((appt) => appt.clinicId === selectedClinicId),
    [appointments, selectedClinicId]
  );

  const selectedPatient = patients.find((p) => p.patientId === selectedPatientId);
  const selectedClinic = clinics.find((c) => c.clinicId === selectedClinicId);

  async function updateStatus(appointment) {
    if (!appointment?.appointmentId || !appointment?.date) return;
    const currentStatus = normalizeStatus(appointment?.status);
    const nextStatus = currentStatus === "Completed" ? "Upcoming" : "Completed";
    try {
      const res = await fetch(`${API_BASE}/api/appointments/${appointment.appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: appointment.date, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to update status");
      setAppointments((prev) =>
        prev.map((item) =>
          item.appointmentId === appointment.appointmentId && item.date === appointment.date
            ? {
                ...data.item,
                status: normalizeStatus(data?.item?.status),
              }
            : item
        )
      );
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to update status");
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow"></p>
          <h1>Imperium Medical Triage Assistant</h1>
          <p className="subtitle">

          </p>
        </div>
        <div className="stats">
          <div>
            <span className="label">Clinics</span>
            <strong>{clinics.length}</strong>
          </div>
          <div>
            <span className="label">Patients</span>
            <strong>{patients.length}</strong>
          </div>
          <div>
            <span className="label">Appointments</span>
            <strong>{appointments.length}</strong>
          </div>
        </div>
      </header>

      {loading && <p className="notice">Loading data from DynamoDB...</p>}
      {error && <p className="notice error">{error}</p>}

      <section className="grid">
        <div className="card">
          <div className="card-header">
            <h2>Clinic Listings</h2>
            <p>Operating hours included</p>
          </div>
          <div className="clinic-list">
            {clinics.map((clinic) => (
              <button
                key={clinic.clinicId}
                className={`clinic-item ${selectedClinicId === clinic.clinicId ? "active" : ""}`}
                onClick={() => setSelectedClinicId(clinic.clinicId)}
                type="button"
              >
                <div>
                  <h3>{clinic.name}</h3>
                  <p>{clinic.address}</p>
                  <p className="muted">{clinic.phone}</p>
                </div>
                <div className="hours">
                  {Array.isArray(clinic.hours)
                    ? clinic.hours.map((slot) => (
                        <div key={slot.day}>
                          <span>{slot.day}</span>
                          <strong>{slot.time}</strong>
                        </div>
                      ))
                    : (
                        <div>
                          <span>Hours</span>
                          <strong>{clinic.hours || "—"}</strong>
                        </div>
                      )}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Patients</h2>
            <p>Identity, contact, and appointment history</p>
          </div>
          <div className="patient-grid">
            <div className="patient-list">
              {patients.map((patient) => (
                <button
                  key={patient.patientId}
                  className={`patient-item ${selectedPatientId === patient.patientId ? "active" : ""}`}
                  onClick={() => setSelectedPatientId(patient.patientId)}
                  type="button"
                >
                  <div>
                    <h3>{patient.name}</h3>
                    <p>IC: {patient.ic}</p>
                    <p className="muted">{patient.phone}</p>
                  </div>
                  <span className="tag">{patient.notes || "No notes"}</span>
                </button>
              ))}
            </div>
            <div className="patient-detail">
              {selectedPatient ? (
                <>
                  <h3>{selectedPatient.name}</h3>
                  <p>IC: {selectedPatient.ic}</p>
                  <p>Phone: {selectedPatient.phone}</p>
                  <div className="history">
                    <h4>Appointment History</h4>
                    {patientAppointments.map((appt) => {
                      const clinic = clinics.find((c) => c.clinicId === appt.clinicId);
                      const status = normalizeStatus(appt?.status);
                      return (
                        <div key={`${appt.appointmentId}-${appt.date}`} className="history-item">
                          <div>
                            <span className={`status ${getStatusClass(status)}`}>
                              {status}
                            </span>
                            <strong>{formatDate(appt.date)}</strong>
                            <span>{formatTime(appt.time)}</span>
                          </div>
                          <p>{clinic?.name}</p>
                          <p className="muted">{appt.summary}</p>
                          <button
                            className="link-button"
                            type="button"
                            onClick={() => updateStatus(appt)}
                          >
                            Mark as {status === "Completed" ? "Upcoming" : "Completed"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p>Select a patient to view details.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Appointments</h2>
          <p>Grouped by clinic and patient</p>
        </div>
        <div className="appointment-grid">
          <div className="filters">
            <label>
              Clinic
              <select value={selectedClinicId} onChange={(e) => setSelectedClinicId(e.target.value)}>
                {clinics.map((clinic) => (
                  <option key={clinic.clinicId} value={clinic.clinicId}>
                    {clinic.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Patient
              <select value={selectedPatientId} onChange={(e) => setSelectedPatientId(e.target.value)}>
                {patients.map((patient) => (
                  <option key={patient.patientId} value={patient.patientId}>
                    {patient.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="appointment-list">
            {clinicAppointments.map((appt) => {
              const patient = patients.find((p) => p.patientId === appt.patientId);
              const status = normalizeStatus(appt?.status);
              return (
                <div key={`${appt.appointmentId}-${appt.date}`} className="appointment-item">
                  <div>
                    <span className={`status ${getStatusClass(status)}`}>{status}</span>
                    <h3>{formatDate(appt.date)}</h3>
                    <p>{formatTime(appt.time)}</p>
                  </div>
                  <div>
                    <p className="muted">Patient</p>
                    <strong>{patient?.name}</strong>
                    <p>{patient?.phone}</p>
                  </div>
                  <div>
                    <p className="muted">Clinic</p>
                    <strong>{selectedClinic?.name}</strong>
                    <p>{selectedClinic?.phone}</p>
                  </div>
                  <div className="summary">
                    <p className="muted">Summary</p>
                    <p>{appt.summary}</p>
                    <button
                      className="link-button"
                      type="button"
                      onClick={() => updateStatus(appt)}
                    >
                      Mark as {status === "Completed" ? "Upcoming" : "Completed"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
