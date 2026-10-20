"use client";

import { useEffect, useRef } from "react";
import type { ProfilePrefs } from "@/lib/fit";

const TYPES = ["Full-time job", "Internship", "Part-time", "Contract", "Freelance", "Graduate / trainee"];
function terms(value: FormDataEntryValue | null): string[] {
  return String(value || "").split(/[,;\n]+/).map(item => item.trim()).filter(item => item.length > 1);
}

export function profileFromForm(form: HTMLFormElement): ProfilePrefs {
  const data = new FormData(form);
  return {
    role: String(data.get("role") || "").trim(),
    location: String(data.get("location") || "").trim(),
    types: data.getAll("opportunityType").map(String).map(t => t === "Full-time job" ? "Full-time" : t),
    experience: String(data.get("experience") || "Any"),
    education: String(data.get("education") || "Any"),
    skills: terms(data.get("skills")),
    industries: terms(data.get("industries")),
    workMode: String(data.get("workMode") || "Any"),
    minimumPay: Number(data.get("minimumPay") || 0),
    availability: String(data.get("availability") || "Any time"),
    workAuth: String(data.get("workAuth") || "Prefer not to say"),
    linkedin: String(data.get("linkedin") || "").trim(),
    profileContext: String(data.get("profileContext") || "").trim()
  };
}

interface PreferencesFormProps {
  busy: boolean;
  /* no API key connected yet → the form stands empty and locked */
  locked: boolean;
  /* bumps every time the session is wiped — the form drops back to blank defaults */
  resetSignal: number;
  /* a restored vault profile — once present, the fields are refilled so the user types nothing again */
  initialProfile: ProfilePrefs | null;
  onSearch: (profile: ProfilePrefs) => void;
  onUnlockKey: () => void;
}

export default function PreferencesForm({ busy, locked, resetSignal, initialProfile, onSearch, onUnlockKey }: PreferencesFormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  /* key cleared (or locked) → the whole form drops back to its blank defaults, like a fresh session */
  useEffect(() => {
    if (locked || resetSignal > 0) formRef.current?.reset();
  }, [locked, resetSignal]);

  /* saved profile returns → silently refill every field (declared after the reset effect
     so a reset and a refill landing in the same commit always end with the refill) */
  useEffect(() => {
    const form = formRef.current;
    if (!form || !initialProfile) return;
    const setByName = (name: string, value: string) => {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.value = value;
    };
    setByName("role", initialProfile.role || "");
    setByName("location", initialProfile.location || "");
    setByName("skills", (initialProfile.skills || []).join(", "));
    setByName("industries", (initialProfile.industries || []).join(", "));
    setByName("minimumPay", initialProfile.minimumPay ? String(initialProfile.minimumPay) : "");
    setByName("linkedin", initialProfile.linkedin || "");
    setByName("profileContext", initialProfile.profileContext || "");
    for (const name of ["experience", "education", "workMode", "availability", "workAuth"] as const) {
      const value = initialProfile[name];
      if (value && value !== "Any" && value !== "Any time" && value !== "Prefer not to say") setByName(name, value);
    }
    /* stored "Full-time" maps back to the checkbox value "Full-time job" */
    const wanted = new Set((initialProfile.types || []).map(t => (t === "Full-time" ? "Full-time job" : t)));
    for (const box of Array.from(form.querySelectorAll<HTMLInputElement>('input[name="opportunityType"]'))) {
      box.checked = wanted.has(box.value);
    }
  }, [initialProfile]);

  return (
    <form
      ref={formRef}
      className={`form ${locked ? "locked" : ""}`}
      autoComplete="on"
      onSubmit={event => {
        event.preventDefault();
        if (locked) { onUnlockKey(); return; }
        onSearch(profileFromForm(event.currentTarget));
      }}
    >
      <div className="pocket pocket-6">
        <div className="pocket-legend"><span className="block-num">1</span> What are you looking for?</div>

        <label className="field-label" htmlFor="role">Target role / job title <b>*</b></label>
        <input className="glass-input" id="role" name="role" placeholder="e.g. Tech analyst" defaultValue="" required disabled={locked} />

        <span className="field-label">Opportunity type <b>*</b><span className="opt">choose any that fit</span></span>
        <div className="type-grid">
          {TYPES.map(type => (
            <label className="choice-pill" key={type}>
              <input type="checkbox" name="opportunityType" value={type} defaultChecked={false} disabled={locked} />
              <span className="tick">✓</span>
              <span>{type}</span>
            </label>
          ))}
        </div>
        <p className="helper">Select one or more. Leave none selected to include all types.</p>

        <div className="two-up">
          <div>
            <label className="field-label" htmlFor="experience">Experience level</label>
            <span className="glass-select-wrap">
              <select className="glass-input" id="experience" name="experience" defaultValue="Any" disabled={locked}>
                <option value="Any">Any experience</option>
                <option>Entry level</option>
                <option>1–3 years</option>
                <option>6–9 years</option>
                <option>10+ years</option>
              </select>
            </span>
          </div>
          <div>
            <label className="field-label" htmlFor="education">Education</label>
            <span className="glass-select-wrap">
              <select className="glass-input" id="education" name="education" defaultValue="Any" disabled={locked}>
                <option value="Any">Any education</option>
                <option>High school</option>
                <option>Associate degree</option>
                <option>Bachelor’s</option>
                <option>Master’s</option>
                <option>Doctorate</option>
              </select>
            </span>
          </div>
        </div>

        <label className="field-label" htmlFor="skills">Skills and tools <b>*</b></label>
        <textarea className="glass-input" id="skills" name="skills" placeholder="Python, SQL, stakeholder communication…" defaultValue="" required disabled={locked} />
        <p className="helper">Comma-separated skills work best. Include tools, strengths, or certifications.</p>

        <label className="field-label" htmlFor="industries">Interests or preferred industries</label>
        <input className="glass-input" id="industries" name="industries" placeholder="e.g. software, climate, fintech" defaultValue="" disabled={locked} />
      </div>

      <div className="pocket pocket-6">
        <div className="pocket-legend"><span className="block-num">2</span> Where and how do you want to work?</div>
        <div className="two-up">
          <div>
            <label className="field-label" htmlFor="location">Preferred location</label>
            <input className="glass-input" id="location" name="location" placeholder="City, region, or country" defaultValue="" disabled={locked} />
          </div>
          <div>
            <label className="field-label" htmlFor="workMode">Work mode</label>
            <span className="glass-select-wrap">
              <select className="glass-input" id="workMode" name="workMode" defaultValue="Any" disabled={locked}>
                <option>Any</option>
                <option>Remote</option>
                <option>Hybrid</option>
                <option>On-site</option>
              </select>
            </span>
          </div>
        </div>
        <div className="two-up">
          <div>
            <label className="field-label" htmlFor="minimumPay">Minimum monthly pay <span className="opt">(₹)</span></label>
            <input className="glass-input" id="minimumPay" name="minimumPay" type="number" min={0} step={5000} placeholder="No minimum" disabled={locked} />
          </div>
          <div>
            <label className="field-label" htmlFor="availability">Availability</label>
            <span className="glass-select-wrap">
              <select className="glass-input" id="availability" name="availability" defaultValue="Any time" disabled={locked}>
                <option>Any time</option>
                <option>Immediately</option>
                <option>Within a month</option>
                <option>Within 3 months</option>
                <option>Flexible</option>
              </select>
            </span>
          </div>
        </div>
        <label className="field-label" htmlFor="workAuth">Work authorization / sponsorship</label>
        <span className="glass-select-wrap">
          <select className="glass-input" id="workAuth" name="workAuth" defaultValue="Prefer not to say" disabled={locked}>
            <option value="Prefer not to say">Prefer not to say</option>
            <option>Eligible to work in India</option>
            <option>Need visa sponsorship</option>
            <option>Open to sponsorship</option>
          </select>
        </span>
      </div>

      <div className="pocket pocket-12">
        <div className="pocket-legend"><span className="block-num">3</span> LinkedIn and profile context</div>
        <div className="two-up">
          <div>
            <label className="field-label" htmlFor="linkedin">LinkedIn profile URL</label>
            <input className="glass-input" id="linkedin" name="linkedin" type="url" placeholder="https://www.linkedin.com/in/your-profile/" disabled={locked} />
            <p className="helper">Profile reference only. CareerRadar can’t read private LinkedIn pages from a URL.</p>
          </div>
          <div>
            <label className="field-label" htmlFor="profileContext">Headline / About / experience summary</label>
            <textarea className="glass-input" id="profileContext" name="profileContext" placeholder="Paste a short profile summary to improve local matching…" disabled={locked} />
          </div>
        </div>
        <div className="privacy-note"><b>⌑</b><span>This profile context stays in this browser. It isn’t sent to TinyFish.</span></div>
      </div>

      <div className="form-actions">
        {locked ? (
          /* the Connect CTA moved up beside "Build your search" — this row keeps the hint only */
          <span className="lock-hint">API key required to search · stays on this device, session only</span>
        ) : (
          <>
            <button className="ghost-btn" type="reset">RESET PROFILE</button>
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? "SCANNING THE WEB…" : "Run the radar ↓"}
            </button>
          </>
        )}
      </div>
      <p className="secure-note"><span className="dot" /> Live career pages · refreshed on every search</p>
    </form>
  );
}
