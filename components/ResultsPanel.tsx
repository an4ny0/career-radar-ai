"use client";

import { useEffect, useState } from "react";
import type { Listing, SearchResponse } from "@/lib/types";
import type { ProfilePrefs, RankedListing } from "@/lib/fit";

function escapeHtml(value: string): string {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
}

function safeHref(value: string): string {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : "#"; } catch { return "#"; }
}

const TYPE_FILTERS = ["All", "Full-time", "Internship", "Part-time", "Contract", "Freelance", "Graduate / trainee"];

interface ResultsPanelProps {
  status: "idle" | "loading" | "done" | "error";
  listings: RankedListing[];
  meta: Partial<SearchResponse>;
  errorText: string;
  prefs: ProfilePrefs | null;
  apiKey: string;
  notify: (message: string) => void;
}

export default function ResultsPanel({ status, listings, meta, errorText, prefs, apiKey, notify }: ResultsPanelProps) {
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [sortByFit, setSortByFit] = useState(true);
  const [openWhy, setOpenWhy] = useState<number | null>(null);
  const [agentBusy, setAgentBusy] = useState<number | null>(null);
  const [agentOut, setAgentOut] = useState<number | null>(null);
  const [agentText, setAgentText] = useState("");
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (status !== "loading") { setStage(0); return; }
    const t1 = window.setTimeout(() => setStage(1), 2400);
    const t2 = window.setTimeout(() => setStage(2), 6500);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [status]);

  const visible = listings
    .filter(job => {
      const matchesType = typeFilter === "All" || job.jobType === typeFilter || job.jobType === "Not specified";
      const haystack = `${job.title} ${job.company} ${job.location} ${job.snippet} ${(job.tags || []).join(" ")}`.toLowerCase();
      return matchesType && (!filter || haystack.includes(filter.toLowerCase()));
    })
    .sort((a, b) => sortByFit ? b.score - a.score : String(a.company).localeCompare(String(b.company)));

  const freshnessClass = status === "loading" ? "searching" : status === "done" ? "updated" : "";
  const freshnessText = status === "loading" ? "SEARCHING" : status === "done" && meta.searchedAt ? `UPDATED ${new Date(meta.searchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "READY";
  const skillCount = prefs ? new Set(prefs.skills.map(s => s.toLowerCase())).size : 0;

  async function verifyAgent(job: Listing, index: number) {
    if (agentBusy !== null) return;
    setAgentBusy(index);
    setAgentText("");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listing: job, apiKey })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Agent check failed.");
      let output = data.result;
      if (typeof output === "string") { try { output = JSON.parse(output); } catch { /* keep string */ } }
      const summary = typeof output === "object" && output
        ? Object.entries(output).map(([key, value]) => `<span class="k">${escapeHtml(key.replaceAll("_", " "))}:</span> ${escapeHtml(Array.isArray(value) ? value.join(", ") : String(value))}`).join(" · ")
        : escapeHtml(output);
      setAgentText(`TinyFish Agent check · ${summary || "Page inspected. Confirm final details with the employer."}`);
      setAgentOut(index);
    } catch (error) {
      setAgentText(error instanceof Error ? error.message : "Agent check failed.");
      setAgentOut(index);
    } finally {
      setAgentBusy(null);
    }
  }

  return (
    <div>
      <div className="glass-slab slab-a">
        <span className="index-chip-light">02 · LIVE RESULTS</span>
        <div className="results-head">
          <div>
            <h2 className="section-title">Your <em>shortlist</em></h2>
            <p className="section-copy">Personalized using your role, skills, experience, and preferences.</p>
          </div>
          <span className={`freshness ${freshnessClass}`}><i /> {freshnessText}</span>
        </div>

        <div className="stat-strip">
          <div className="stat"><strong>{listings.length ? listings.length : status === "done" ? 0 : "—"}</strong><span>Matching opportunities</span></div>
          <div className="stat"><strong>{skillCount}</strong><span>Skills identified</span></div>
          <div className="stat"><strong>{meta.fetched ?? 0}</strong><span>Live pages read</span></div>
        </div>

        <div className="result-bar">
        <label className="filter-search">
          <span className="mag">⌕</span>
          <input type="search" placeholder="Filter by title, company, skill…" value={filter} onChange={event => setFilter(event.target.value)} aria-label="Filter results" />
        </label>
        <span className="glass-select-light">
          <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} aria-label="Filter by type">
            {TYPE_FILTERS.map(t => <option key={t}>{t}</option>)}
          </select>
        </span>
        <button className={`sort-btn ${sortByFit ? "on" : ""}`} onClick={() => setSortByFit(v => !v)} aria-label="Toggle sort">
          {sortByFit ? "BEST FIT ↕" : "COMPANY A–Z ↕"}
        </button>
      </div>

        <div className="list-meta">
          <span>{status === "done" || status === "loading" ? (listings.length ? `Showing ${visible.length} of ${listings.length} matching opportunities` : "Reading live sources…") : "Set your preferences and search"}</span>
        </div>
      </div>

      <div className="glass-slab slab-b">{status === "idle" && (
        <div className="state-card">
          <div className="orb-icon">↗</div>
          <h3>Your next opportunity starts here.</h3>
          <p>Build your profile and search current career pages. We’ll rank openings against what matters to you.</p>
        </div>
      )}

      {status === "loading" && (
        <div className="state-card">
          <div className="loading-ui">
            <div className="radar-loader" />
            <div>
              <b style={{ display: "block", marginBottom: 4 }}>Finding your fit</b>
              <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{["Searching live company career pages…", "Reading the pages TinyFish discovered…", "Scoring every listing against your profile…"][stage]}</span>
            </div>
            <div className="stage-rail">
              <span className={stage >= 0 ? "active" : ""}>SEARCH</span><i className={stage >= 1 ? "active" : ""} />
              <span className={stage >= 1 ? "active" : ""}>READ</span><i className={stage >= 2 ? "active" : ""} />
              <span className={stage >= 2 ? "active" : ""}>MATCH</span>
            </div>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="state-card">
          <div className="err-icon">!</div>
          <h3>We hit a snag</h3>
          <p>{errorText || "Could not reach TinyFish. Add your API key and try again."}</p>
        </div>
      )}

      {status === "done" && listings.length === 0 && (
        <div className="state-card">
          <div className="orb-icon">⌕</div>
          <h3>No live opportunities found.</h3>
          <p>{meta.message || "Try changing your role, location, or career sources and search again."}</p>
        </div>
      )}

      {status === "done" && listings.length > 0 && visible.length === 0 && (
        <div className="state-card">
          <div className="orb-icon">⌕</div>
          <b>No results match those filters.</b>
          <p>Try another type or search term.</p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="results-list">
          {visible.map((job, index) => {
            const host = (() => { try { return new URL(safeHref(job.url)).hostname.replace(/^www\./, ""); } catch { return "careers"; } })();
            const skills = job.matchedSkills?.length ? job.matchedSkills : (job.tags || []).filter(tag => !/remote|hybrid|full.time|intern|visa/i.test(tag)).slice(0, 4);
            const ringColor = job.score >= 75 ? "var(--rate-good)" : job.score >= 50 ? "var(--rate-mid)" : "var(--accent)";
            return (
              <article className={`job-card ${openWhy === index ? "open" : ""}`} key={job.id || job.url} style={{ animationDelay: `${Math.min(index * 45, 260)}ms` }}>
                <div className="score-wrap">
                  <span className="score-ring" style={{ ["--fit" as string]: job.score, ["--ring-color" as string]: ringColor }}>
                    <b style={{ color: ringColor }}>{job.score}</b>
                  </span>
                </div>

                <div className="job-main">
                  <div className="job-line1">
                    <h3 className="job-title">{escapeHtml(job.title)}</h3>
                    {index < 2 && <span className="new-badge">NEW</span>}
                  </div>
                  <div className="job-co-row">
                    <span className="co-name">{escapeHtml(job.company || host)}</span>
                    <span>·</span>
                    <span>{escapeHtml(job.location || "Location not listed")}</span>
                    <span>·</span>
                    <span>{escapeHtml(job.jobType || "Role")}</span>
                    {job.posted ? <><span>·</span><span className="posted">{escapeHtml(job.posted)}</span></> : null}
                  </div>
                  <div className="reason-chips">
                    {(job.reasons || []).slice(0, 2).map((reason, i) => <span className="reason-chip" key={i}>{escapeHtml(reason.length > 52 ? `${reason.slice(0, 52)}…` : reason)}</span>)}
                  </div>
                </div>

                <div className="job-side">
                  <span className="job-host">{escapeHtml(host)}</span>
                  <div className="job-actions">
                    <button
                      className="why-btn"
                      aria-expanded={openWhy === index}
                      aria-label={`Why does ${job.title} score ${job.score}?`}
                      onClick={() => { setOpenWhy(openWhy === index ? null : index); setAgentOut(null); }}
                    >
                      Why this score?
                    </button>
                    <a className="apply-btn" href={safeHref(job.url)} target="_blank" rel="noreferrer">Apply ↗</a>
                  </div>
                </div>

                {openWhy === index && (
                  <div className="agent-peek">
                    {/* left: posting in a browser frame */}
                    <div className="agent-detail">
                      <div className="detail-chrome">
                        <span className="cl" /><span className="cl" /><span className="cl" />
                        <span className="detail-url">{escapeHtml(safeHref(job.url))}</span>
                      </div>
                      <div className="detail-body">
                        <h4>{escapeHtml(job.title)}</h4>
                        <p className="detail-loc"><span>◉</span> {escapeHtml([job.location || "Location not listed", job.workMode, job.seniority, job.salary, job.fetchStatus].filter(Boolean).join(" · "))}</p>
                        <p className="detail-snip">{escapeHtml(job.snippet || "Open the employer page to review the complete role description and application details.")}</p>
                        {skills.length > 0 && (
                          <div className="detail-skills">
                            {skills.slice(0, 6).map((skill, i) => <span className="skill" key={i}>{escapeHtml(skill)}</span>)}
                          </div>
                        )}
                        {job.fetchStatus === "Search snippet only" && (
                          <span className="detail-note">TinyFish couldn’t read the full page — confirm details on the employer site.</span>
                        )}
                      </div>
                    </div>
                    {/* right: tinyfish agent live list */}
                    <div className="agent-live-list">
                      <div className="live-title">TINYFISH WEB AGENT · LIVE</div>
                      <ul>
                        <li><i>›</i> Starting a browser agent…</li>
                        <li><i>›</i> Browser launched</li>
                        <li><i>›</i> Visit job posting page for {escapeHtml(job.title.length > 38 ? `${job.title.slice(0, 38)}…` : job.title)}</li>
                        <li><i>›</i> Extract full job posting details</li>
                        {agentOut === index
                          ? <li className="done"><i>✓</i> Agent inspection complete</li>
                          : <li><i>›</i> Extract detailed job posting information</li>}
                      </ul>
                      <button className="agent-btn" disabled={agentBusy !== null || agentOut === index} onClick={() => verifyAgent(job, index)}>
                        {agentBusy === index ? "TinyFish Agent is reading this page…" : agentOut === index ? "Agent checked ✓" : "Ask TinyFish Agent to inspect this listing ↗"}
                      </button>
                      {agentOut === index && agentText && <div className="agent-out" dangerouslySetInnerHTML={{ __html: agentText }} />}
                      <a className="open-posting" href={safeHref(job.url)} target="_blank" rel="noreferrer">Open posting ↗</a>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="post-note">
        <span className="sp">✳</span>
        <span>Live listings, real links — each result comes from a current career page. Match scores are estimates based on listing text and your selected preferences, not hiring decisions.</span>
      </div>
      <div className="powered"><span>POWERED BY</span><b>TINYFISH SEARCH · FETCH · AGENT</b></div>
      </div>
    </div>
  );
}
