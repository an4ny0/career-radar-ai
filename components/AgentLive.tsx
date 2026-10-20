"use client";

import { useEffect, useRef } from "react";

/* The live agent window shown mid-transition during a search:
   left = simulated browser with a moving agent cursor,
   right = timestamped feed of everything the agent did. */

export interface AgentStep {
  ts: string;              // "19:09:15"
  text: string;
  kind?: "info" | "ok" | "warn";
}

interface AgentLiveProps {
  open: boolean;
  done: boolean;
  carried: number;                       // opportunities captured so far
  page: string;                          // fake URL the agent is currently on
  companyName: string;                   // heading inside the mock browser
  steps: AgentStep[];
}

export default function AgentLive({ open, done, carried, page, companyName, steps }: AgentLiveProps) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [steps.length]);

  if (!open) return null;
  return (
    <div className={`agent-live ${done ? "done" : ""}`}>
      <div className="agent-live-head">
        <span className="caret">▼</span> See what the agent is doing
      </div>
      <div className="agent-live-grid">
        {/* ---------------- left: live browser ---------------- */}
        <div className="agent-browser">
          <div className="agent-chrome">
            <span className="cl" />
            <span className="cl" />
            <span className="cl" />
            <span className={`agent-url ${done ? "done" : ""}`}>
              <b className="padlock">●</b>
              <span className="url-text">{page}</span>
            </span>
          </div>
          <div className="agent-canvas">
            <div className="canvas-head">
              <span className="canvas-mark">{(companyName || "CR").slice(0, 2).toUpperCase()}</span>
              <span className="canvas-title">{companyName || "Sweeping career pages…"}</span>
              <span className="canvas-cta">Apply</span>
            </div>
            <div className="canvas-lines">
              <i className="w-92" /><i className="w-78" /><i className="w-84" /><i className="w-62" /><i className="w-88" /><i className="w-40" />
            </div>
            <span className="agent-cursor" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 30 30"><path d="M4 2 L4 24 L10 18 L13 27 L16 26 L13 17 L21 17 Z" fill="#ff8a1e" stroke="#fff7ef" strokeWidth="1.4" /></svg>
            </span>
            {done && <span className="canvas-check">✓</span>}
          </div>
        </div>

        {/* ---------------- right: timestamped steps ---------------- */}
        <div className="agent-feed" ref={feedRef}>
          {steps.map((step, i) => (
            <div className="agent-step" key={i}>
              <span className="agent-ts">{step.ts}</span>
              <span className={`agent-act ${step.kind || ""}`}>
                <i>{step.kind === "ok" ? "✓" : step.kind === "warn" ? "!" : "›"}</i>
                {step.text}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className={`agent-live-foot ${done ? "show" : ""}`}>
        {done
          ? <>Scroll down to see your shortlist <b>↓</b> <span className="cap">{carried} opportunities captured</span></>
          : <span className="cap">{steps.length ? "Working…" : "Waking the TinyFish web agent…"}</span>}
      </div>
    </div>
  );
}

export function agentClock(): string {
  return new Date().toLocaleTimeString([], { hour12: false });
}
