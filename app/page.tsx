"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { RadarPingJob } from "@/components/RadarCanvas";
import PreferencesForm from "@/components/PreferencesForm";
import ResultsPanel from "@/components/ResultsPanel";
import KeyModal from "@/components/KeyModal";
import AgentLive, { agentClock, type AgentStep } from "@/components/AgentLive";
import { rankLocal, type ProfilePrefs } from "@/lib/fit";
import type { SearchResponse } from "@/lib/types";
import type { Listing } from "@/lib/types";

/* the 3D stage ships as its own async chunk — Three.js (~600 KB) leaves the first paint
   entirely, then the globe arms itself after `load` + idle below. Every visual detail of
   the animation is preserved; only its start time moves later, after the hero paints. */
const RadarCanvas = dynamic(() => import("@/components/RadarCanvas"), { ssr: false, loading: () => null });

const KEY_STORE = "dtuCareerRadarTinyFishKey";
/* device-only saved session (profile + last shortlist). Lives in localStorage on the
   user's machine — never sent anywhere — and is only shown while a key is connected.
   The in-memory mirror is the primary source; localStorage is a best-effort bonus so the
   app stays fully functional even in browsers that block storage. */
const VAULT_STORE = "dtuCareerRadarVault";

type Vault = { profile?: ProfilePrefs; listings?: ReturnType<typeof rankLocal>[]; meta?: Partial<SearchResponse> };

function storageVault(): Vault {
  try { return JSON.parse(localStorage.getItem(VAULT_STORE) || "{}") as Vault; } catch { return {}; }
}

/* tolerate hand-edited / partial stored profiles — array fields must exist */
function normalizeProfile(p: ProfilePrefs): ProfilePrefs {
  return { ...p, skills: Array.isArray(p.skills) ? p.skills : [], industries: Array.isArray(p.industries) ? p.industries : [], types: Array.isArray(p.types) ? p.types : [] };
}

type Status = "idle" | "loading" | "done" | "error";

/* radar logo mark: dial + sweep wedge */
function RadarMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="11.5" stroke="currentColor" strokeWidth="1.6" opacity="0.9" />
      <circle cx="14" cy="14" r="6.5" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
      <circle cx="14" cy="14" r="1.8" fill="currentColor" />
      <path d="M14 14 L22.5 8.5 A10.5 10.5 0 0 1 24.5 14 Z" fill="#ff452a" opacity="0.85" />
    </svg>
  );
}

export default function Page() {
  const [apiKey, setApiKey] = useState("");
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [soundOn] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [toast, setToast] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [profile, setProfile] = useState<ProfilePrefs | null>(null);
  const [listings, setListings] = useState<ReturnType<typeof rankLocal>[]>([]);
  const [meta, setMeta] = useState<Partial<SearchResponse>>({});
  const [errorText, setErrorText] = useState("");
  const [radarTick, setRadarTick] = useState("");
  const [tickPing, setTickPing] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [agentPage, setAgentPage] = useState("radar://sweeping");
  const [agentStage, setAgentStage] = useState(0);
  /* bumps on every session wipe — tells the form to drop back to blank */
  const [sessionEpoch, setSessionEpoch] = useState(0);

  /* 0..1 scroll zoom progress */
  const [zoom, setZoom] = useState(0);
  /* the globe mounts only after the page has loaded and the browser goes idle —
     hero text paints first on slow phones, the radar sweeps in right behind it */
  const [globeOn, setGlobeOn] = useState(false);
  /* demo flag is read after mount — not during render, so SSR markup stays stable */
  const [demoEnabled, setDemoEnabled] = useState(false);
  const veilRef = useRef<HTMLDivElement>(null);
  const tickTimer = useRef(0);
  /* in-memory vault: survives a disconnect (clear) within the same page, so reconnecting
     brings the data back even when the browser refuses storage entirely */
  const vaultRef = useRef<Vault>({});

  /* saved data returns only while a key is connected — never otherwise */
  const hydrateVault = useCallback(() => {
    if (vaultRef.current.profile || (vaultRef.current.listings || []).length) return vaultRef.current;
    vaultRef.current = storageVault();
    return vaultRef.current;
  }, []);

  const persistVault = useCallback((patch: Vault) => {
    vaultRef.current = { ...vaultRef.current, ...patch };
    /* device copy is best-effort — a storage-restricted browser still gets full function */
    try { localStorage.setItem(VAULT_STORE, JSON.stringify(vaultRef.current)); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { setDemoEnabled(new URLSearchParams(window.location.search).get("demo") === "1"); } catch { /* ignore */ }
  }, []);

  /* arm the 3D stage after `load` + first idle: requestIdleCallback when present
     (with a 2.2s cap so a busy main thread can't starve it), a short timer otherwise */
  useEffect(() => {
    let cancelled = false;
    let disarm: () => void = () => {};
    const w = window as typeof window & {
      requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const arm = () => {
      if (cancelled) return;
      if (typeof w.requestIdleCallback === "function" && typeof w.cancelIdleCallback === "function") {
        const id = w.requestIdleCallback(() => { if (!cancelled) setGlobeOn(true); }, { timeout: 2200 });
        disarm = () => w.cancelIdleCallback(id);
      } else {
        const id = window.setTimeout(() => { if (!cancelled) setGlobeOn(true); }, 1400);
        disarm = () => window.clearTimeout(id);
      }
    };
    if (document.readyState === "complete") arm();
    else {
      window.addEventListener("load", arm, { once: true });
      disarm = () => window.removeEventListener("load", arm);
    }
    return () => { cancelled = true; disarm(); };
  }, []);

  useEffect(() => {
    try {
      const key = sessionStorage.getItem(KEY_STORE) || "";
      setApiKey(key);
      const vault = hydrateVault();
      if (key) {
        if (vault.profile) setProfile(normalizeProfile(vault.profile));
        if (Array.isArray(vault.listings) && vault.listings.length) {
          setListings(vault.listings);
          setMeta(vault.meta || {});
          setStatus("done");
        }
      }
      const t = localStorage.getItem("cr-theme");
      if (t === "dark" || t === "light") setTheme(t);
    } catch { /* storage unavailable */ }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [hydrateVault]);

  /* scroll choreography: globe zooms to centre under the preferences veil */
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let rafId = 0;
    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (navRef.current) navRef.current.classList.toggle("away", window.scrollY > 130);
        const prefs = document.getElementById("prefs");
        if (!prefs) return;
        const vh = window.innerHeight;
        /* cinematic runway: the zoom + veil ride across ~2.1 viewports of scroll */
        const start = prefs.offsetTop - vh * 2.35;
        const full = prefs.offsetTop - vh * 0.2;
        const end = prefs.offsetTop + prefs.offsetHeight - vh * 0.3;
        /* ~2 viewports of scroll for the exit reveal */
        const rise = Math.min(1, Math.max(0, (window.scrollY - start) / Math.max(1, full - start)));
        const fall = Math.min(1, Math.max(0, (window.scrollY - end) / (vh * 2)));
        const veil = rise * (1 - fall);
        setZoom(rise * (1 - fall));
        if (veilRef.current) veilRef.current.style.opacity = veil.toFixed(3);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(rafId);
    };
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  /* deliberate 4.4s eased glide — transitions should feel intentional, like a stage move */
  const smoothScrollTo = useCallback((targetY: number, duration = 4400) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { window.scrollTo(0, targetY); return; }
    const start = window.scrollY;
    const delta = targetY - start;
    if (Math.abs(delta) < 2) return;
    const t0 = performance.now();
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      window.scrollTo(0, start + delta * ease(p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  /* narrated glide: the ticker narrates the move for the eye to follow */
  const glideTo = useCallback((id: string, tick: string, inset = 0) => {
    const el = document.getElementById(id);
    if (!el) return;
    setRadarTick(tick);
    setTickPing(true);
    window.clearTimeout(tickTimer.current);
    tickTimer.current = window.setTimeout(() => {
      setRadarTick("");
      setTickPing(false);
    }, 4600);
    /* document-absolute position — stays correct for nested headings whose offsetTop
       is measured against a positioned ancestor rather than the page */
    smoothScrollTo(Math.max(0, el.getBoundingClientRect().top + window.scrollY - inset));
  }, [smoothScrollTo]);

  /* sections fade-glaze in once, ~0.95s, as they enter the viewport */
  useEffect(() => {
    const targets = document.querySelectorAll(".zoom-head, .form-holder, .glass-slab");
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      }
    }, { threshold: 0.16 });
    targets.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("cr-theme", next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const agentTimers = useRef<number[]>([]);
  const clearAgentTimers = useCallback(() => {
    for (const id of agentTimers.current) window.clearTimeout(id);
    agentTimers.current = [];
  }, []);

  const saveKey = useCallback((key: string) => {
    try { sessionStorage.setItem(KEY_STORE, key); } catch { /* storage unavailable — in-memory only */ }
    setApiKey(key);
    setKeyModalOpen(false);
    /* reconnect: everything saved earlier — device or just this page — is brought straight back */
    const vault = hydrateVault();
    let restored = false;
    if (vault.profile) { setProfile(normalizeProfile(vault.profile)); restored = true; }
    if (Array.isArray(vault.listings) && vault.listings.length) {
      setListings(vault.listings);
      setMeta(vault.meta || {});
      setStatus("done");
      restored = true;
    }
    notify(restored ? "TinyFish connected — your saved profile and shortlist are back." : "TinyFish connected for this browser session.");
  }, [notify, hydrateVault]);

  /* clearing the key = a fresh incognito LOOK: the form, shortlist and agent vanish and the
     site stands vanilla — but the vault stays safely on this device until the key returns */
  const clearKey = useCallback(() => {
    try {
      sessionStorage.removeItem(KEY_STORE);
      sessionStorage.removeItem("dtuCareerRadarProfile"); /* legacy key cleanup */
    } catch { /* storage unavailable */ }
    clearAgentTimers();
    setApiKey("");
    setKeyModalOpen(false);
    setProfile(null);
    setListings([]);
    setMeta({});
    setStatus("idle");
    setErrorText("");
    setAgentOpen(false);
    setAgentSteps([]);
    setAgentPage("radar://sweeping");
    setAgentStage(0);
    notify("Key cleared — your data is saved on this device until you reconnect.");
    setSessionEpoch(epoch => epoch + 1);
    /* if the eye is down at the results, glide it back to the now-locked empty form */
    const prefsEl = document.getElementById("prefs");
    if (prefsEl && window.scrollY > prefsEl.offsetTop - 120) {
      glideTo("prefs", "SESSION CLEARED · FRESH RADAR");
    }
  }, [notify, glideTo, clearAgentTimers]);

  const pushAgentStep = useCallback((text: string, delay: number, kind: AgentStep["kind"] = "info") => {
    agentTimers.current.push(window.setTimeout(() => {
      setAgentSteps(prev => [...prev, { ts: agentClock(), text, kind }]);
    }, delay));
  }, []);

  /* shared landing path for real + demo searches */
  const finishSearch = useCallback((prefs: ProfilePrefs, data: Partial<SearchResponse>) => {
    const ranked = (data.results || []).map(job => rankLocal(job, prefs));
    clearAgentTimers();
    pushAgentStep(`${ranked.length} live opportunities captured${data.fetched ? ` from ${data.fetched} pages` : ""}`, 200);
    pushAgentStep("Agent finished · shortlist ranked", 1000, "ok");
    setListings(ranked);
    setMeta(data);
    setStatus("done");
    /* the shortlist joins the vault — it comes back next time a key is connected */
    if (!demoEnabled) persistVault({ profile: prefs, listings: ranked, meta: data });
    /* hold the agent stage a beat, then let the exit veil carry on to the shortlist */
    agentTimers.current.push(window.setTimeout(() => {
      glideTo("results", "RESULTS INCOMING · LOCKING RANKS");
      agentTimers.current.push(window.setTimeout(() => setAgentOpen(false), 4600));
    }, 2400));
    notify(ranked.length ? `Found ${ranked.length} ranked opportunities.` : "Search complete — no matches this time.");
  }, [clearAgentTimers, pushAgentStep, glideTo, notify, demoEnabled, persistVault]);

  /* demo playback data — also usable at career-radar.app/?demo=1 without an API key */
  const DEMO_RAW: Listing[] = [
    {
      id: "demo-1", title: "Software Engineer (Machine Learning) Intern (Summer 2027)", company: "Affirm",
      location: "San Francisco, California (Remote)", seniority: "Intern", jobType: "Internship", workMode: "Remote",
      salary: "$60/hr", salaryValue: 60, posted: "13d ago", snippet: "At Affirm, we work on meaningful projects and ship code frequently. Interns join a real-time high-throughput data processing pipeline, develop an automated testing framework, and ship to production within weeks of starting.",
      url: "https://job-boards.greenhouse.io/affirm/jobs/80008645003", source: "greenhouse",
      tags: ["ML", "Python", "React", "Video", "Test", "Data"], updatedAt: new Date().toISOString(), score: 0, matched: [],
      fetchStatus: "Full page read"
    },
    {
      id: "demo-2", title: "Undergrad Intern — Software Engineer — Technology (AI)", company: "Amgen",
      location: "Hyderabad (Hybrid)", seniority: "Intern", jobType: "Internship", workMode: "Hybrid",
      salary: "₹4.2L/yr", salaryValue: 420000, posted: "30d ago", snippet: "Join the Information Systems team building the platform that powers every stage of the drug development lifecycle. Software engineers at Amgen blend cloud engineering with biology-scale data to create solutions that improve patients' lives.",
      url: "https://amgen.wd1.myworkdayjobs.com/amgen", source: "workday",
      tags: ["Java", "Python", "SQL", "AWS", "React", "Test"], updatedAt: new Date().toISOString(), score: 0, matched: [],
      fetchStatus: "Full page read"
    },
    {
      id: "demo-3", title: "Frontend Engineer (React) — Growth Team", company: "Zerodha",
      location: "Bengaluru (On-site)", seniority: "Mid", jobType: "Full-time", workMode: "On-site",
      salary: "Not listed", salaryValue: 0, posted: "22h ago", snippet: "Build the dashboards that four million traders look at every morning. We are a small team that ships carefully — you'd own the trading experience end to end, from design reviews to production, using a lean stack with no build-time bloat.",
      url: "https://jobs.zerodha.com/careers/frontend", source: "company",
      tags: ["React", "TypeScript", "Dashboard", "Test"], updatedAt: new Date().toISOString(), score: 0, matched: [],
      fetchStatus: "Full page read"
    }
  ];

  const runSearch = useCallback(async (prefs: ProfilePrefs) => {
    const demo = demoEnabled;
    if (!apiKey) {
      /* the radar is strictly a connected service — no key, no search */
      setKeyModalOpen(true);
      notify("Connect your TinyFish API key to search live opportunities.");
      return;
    }
    setProfile(prefs);
    /* profile joins the vault right away (skipped in demo playback) */
    if (!demo) persistVault({ profile: prefs });
    clearAgentTimers();
    setAgentOpen(true);
    setAgentSteps([]);
    setAgentPage("radar://agent/starting");
    setAgentStage(0);
    setStatus("loading");
    setErrorText("");
    setListings([]);

    /* glide to the middle of the exit corridor — the agent takes the stage there */
    const el = document.getElementById("reveal");
    if (el) {
      const mid = el.offsetTop + el.offsetHeight / 2 - window.innerHeight / 2;
      setRadarTick("AGENT LIVE · WATCH THE SWEEP");
      setTickPing(true);
      window.clearTimeout(tickTimer.current);
      tickTimer.current = window.setTimeout(() => { setRadarTick(""); setTickPing(false); }, 4600);
      smoothScrollTo(Math.max(0, mid));
    }

    /* narrated agent timeline, paced with the real request */
    pushAgentStep("TinyFish web agent online (stealth retry)", 500);
    pushAgentStep("Starting a browser agent…", 1300);
    pushAgentStep("Browser launched · live view ready", 2100);
    pushAgentStep(`Searching career pages for “${prefs.role}”`, 3100);
    setAgentPage("https://job-boards.greenhouse.io");
    setAgentStage(1);
    pushAgentStep("Reading the pages the agent discovered…", 4100);
    setAgentPage("https://api-fetch.read/extract-full-postings");
    setAgentStage(2);
    pushAgentStep("Extracting full posting details — role, way of working, dates", 5200);
    pushAgentStep("Reading individual postings as the agent visits them", 6200);
    setAgentPage("https://agent.tinyfish.ai/ranking");
    pushAgentStep("Scoring every opening against your profile", 7300);

    if (demo) {
      pushAgentStep("DEMO MODE · playing back a captured sweep", 4300, "warn");
      setAgentPage("https://job-boards.greenhouse.io/affirm");
      agentTimers.current.push(window.setTimeout(() => {
        finishSearch(prefs, { results: DEMO_RAW, fetched: 14, searchedAt: new Date().toISOString(), totalFound: 35 });
      }, 8200));
      return;
    }

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: prefs.role,
          location: prefs.location,
          keywords: [...prefs.skills, ...prefs.industries].join(", "),
          opportunityTypes: prefs.types,
          sources: ["greenhouse", "lever", "workday", "company"],
          apiKey
        })
      });
      const data = (await response.json()) as Partial<SearchResponse> & { error?: string };
      if (!response.ok) throw new Error(data.error || `Search failed (${response.status}).`);
      finishSearch(prefs, data);
    } catch (error) {
      clearAgentTimers();
      pushAgentStep(error instanceof Error ? error.message : "Could not reach TinyFish.", 300, "warn");
      setStatus("error");
      agentTimers.current.push(window.setTimeout(() => setAgentOpen(false), 1800));
    }
  }, [apiKey, notify, glideTo, smoothScrollTo, clearAgentTimers, pushAgentStep, finishSearch, demoEnabled]);
  const pipJobs = useMemo<RadarPingJob[]>(
    () => listings.filter(job => job.score >= 55).map(job => ({ title: job.title, company: job.company, score: job.score })),
    [listings]
  );

  const onPing = useCallback((job: RadarPingJob | null) => {
    setRadarTick(job ? `${job.title} · ${job.company} — ${Math.round(job.score)} FIT` : "Sweeping live career pages…");
    setTickPing(Boolean(job));
    window.clearTimeout(tickTimer.current);
    tickTimer.current = window.setTimeout(() => setTickPing(false), 1600);
  }, []);

  return (
    <>
      {/* fixed 3D stage + scroll veil — stage mounts after first idle (perf, detail intact) */}
      {globeOn && <RadarCanvas listings={pipJobs} soundOn={soundOn} onPing={onPing} zoom={zoom} />}
      <div ref={veilRef} className="zoom-veil" aria-hidden="true" />

      <nav ref={navRef} className="nav">
        <div className="nav-inner">
          <a className="brand" href="#top" aria-label="CareerRadar home" onClick={(e) => { e.preventDefault(); glideTo("top", "RETURNING TO BASE RANGE"); }}>
            <span className="brand-mark"><RadarMark /></span>
            <span>CareerRadar<span className="tld">.ai</span></span>
          </a>
        </div>
        <div className="nav-actions">
          <button className={`ghost-btn icon-btn ${theme === "dark" ? "on" : ""}`} onClick={toggleTheme} aria-label="Toggle color theme">
            {theme === "dark" ? "☾" : "☀"}
          </button>
          <button className={`ghost-btn ${apiKey ? "connected" : ""}`} onClick={() => setKeyModalOpen(true)}>
            {apiKey ? <>API KEY <span className="st">CONNECTED</span></> : "ADD API KEY"}
          </button>
        </div>
      </nav>

      <main id="top">
        {/* -------------------- hero -------------------- */}
        <section className="hero">
          <div className="wrap hero-inner">
            <div className="hero-copy">
              <span className="hero-eyebrow"><i /> CAREER RADAR</span>
              <h1>
                Find <span className="work">WORK</span>
                <br />
                that Moves you<span className="dot">.</span>
              </h1>
              <p className="hero-tagline">More than a job finder.</p>
              <div className="hero-sub">
                <button className="btn-primary hero-cta" onClick={() => glideTo("build-head", "ENTERING RADAR RANGE · HOLD STEADY", 96)}>
                  Build your search ↓
                </button>
              </div>
              <div className="hero-note"><b>✳</b><span>Live company pages · refreshed on every search.</span></div>
            </div>

            <div className={`radar-ticker ${tickPing ? "ping" : ""}`} role="status">
              <span className="tick-dot" />
              <span>{radarTick || "Radar ready · set your search"}</span>
            </div>
            <div className="scroll-cue"><span className="line" /> Scroll to build your search</div>
          </div>
        </section>

        {/* -------------------- entry corridor · silent runway for the zoom -------------------- */}
        <section className="cinema cinema-in" aria-hidden="true" />

        {/* -------------------- 01 · zoom overlay + preferences -------------------- */}
        <section id="prefs" className="zoom-section">
          <div className="wrap">
            <div className="zoom-head">
              <span className="index-chip"><span className="pin">◍</span>01 · PREFERENCES</span>
              <div className="zoom-row">
                <h2 className="zoom-title" id="build-head">Build your <em>search.</em></h2>
                {!apiKey && (
                  <button className="btn-primary connect-head" type="button" onClick={() => setKeyModalOpen(true)}>
                    Connect API key
                  </button>
                )}
              </div>
              <p className="zoom-copy">Shape the search around what you actually want — role, skills, location, timing. The radar holds the range while you dial it in.</p>
            </div>
            <div className="form-holder">
              <PreferencesForm
                busy={status === "loading"}
                locked={!apiKey}
                resetSignal={sessionEpoch}
                initialProfile={profile}
                onSearch={runSearch}
                onUnlockKey={() => setKeyModalOpen(true)}
              />
            </div>
          </div>
        </section>

        {/* -------------------- exit corridor · agent stage during search -------------------- */}
        <section className="cinema cinema-out" id="reveal">
          <div className="agent-holder">
            <AgentLive
              open={agentOpen}
              done={status === "done"}
              carried={listings.length}
              page={agentPage}
              companyName={agentStage >= 2 ? "Reading live postings…" : "Career page"}
              steps={agentSteps}
            />
          </div>
        </section>

        {/* -------------------- 02 · shortlist -------------------- */}
        <section id="results" className="results-section">
          <div className="wrap">
            <ResultsPanel
              status={status}
              listings={listings}
              meta={meta}
              errorText={errorText}
              prefs={profile}
              apiKey={apiKey}
              notify={notify}
            />
          </div>
        </section>
      </main>

      <footer className="page-footer">
        <span><b>CAREER RADAR</b></span>
        <span>MADE FOR THE SEARCH THAT MATTERS.</span>
        <span>DTU × TINYFISH</span>
      </footer>

      <KeyModal
        open={keyModalOpen}
        currentKey={apiKey}
        onClose={() => setKeyModalOpen(false)}
        onSave={saveKey}
        onClear={clearKey}
      />

      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
