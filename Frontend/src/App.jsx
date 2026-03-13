import React, { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
marked.setOptions({
  breaks: true,
  gfm: true,
});

const starterMessages = [
  {
    id: "sys-1",
    role: "assistant",
    text: "Hello! Welcome to Imperium Medical Triage Assistant. Please let me know your name, phone or IC and also state your symptoms.",
  },
];

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function App() {
  const [messages, setMessages] = useState(starterMessages);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("idle");

  const timeline = useMemo(() => messages.slice(), [messages]);

  async function sendMessage(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || status === "loading") return;

    console.log("[UI] sending message", { length: text.length });
    const outgoing = { id: crypto.randomUUID(), role: "user", text, time: new Date() };
    const nextMessages = [...messages, outgoing];
    setMessages(nextMessages);
    setInput("");
    setStatus("loading");
    const startedAtPerf = performance.now();

    try {
      console.log("[UI] request -> backend", { url: `${BACKEND_URL}/api/chat` });
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: nextMessages.map((m) => ({
            role: m.role,
            text: m.text,
          })),
        }),
      });

      const data = await res.json();
      console.log("[UI] response <- backend", { ok: res.ok, status: res.status });
      if (!res.ok) {
        throw new Error(data?.error || "Server error");
      }

      const replyText = data?.text || "(No response text returned)";
      console.log("[UI] assistant reply", { length: replyText.length });
      const latencyMs = Math.max(0, performance.now() - startedAtPerf);
      const reply = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: replyText,
        time: new Date(),
      };
      setMessages((prev) => [...prev, reply]);
    } catch (err) {
      console.error("[UI] request failed", err);
      const latencyMs = Math.max(0, performance.now() - startedAtPerf);
      const reply = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: `Error: ${err.message}`,
        time: new Date(),
      };
      setMessages((prev) => [...prev, reply]);
    } finally {
      setStatus("idle");
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="kicker"></p>
          <h1>Imperium Medical Triage Assistant Portal</h1>
        </div>
        <div className="status">
          <span className={`dot ${status}`} />
          {status === "loading" ? "Thinking" : "Ready"}
        </div>
      </header>

      <main className="chat">
        {timeline.map((message) => (
          <div key={message.id} className={`bubble ${message.role}`}>
            <div className="meta">
              <span>{message.role === "user" ? "You" : "Agent"}</span>
              {message.time && <span>{formatTime(message.time)}</span>}
            </div>
            <div
              className="content"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(marked.parse(message.text || "")),
              }}
            />
          </div>
        ))}
      </main>

      <form className="composer" onSubmit={sendMessage}>
        <textarea
          rows={1}
          placeholder="Ask the agent about your indexed data..."
          value={input}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (input.trim() && status !== "loading") {
                sendMessage(event);
              }
            }
          }}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={!input.trim() || status === "loading"}>
          Send
        </button>
      </form>
    </div>
  );
}
