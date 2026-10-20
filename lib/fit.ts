import type { Listing } from "./types";

export interface ProfilePrefs {
  role: string;
  location: string;
  types: string[];
  experience: string;
  education: string;
  skills: string[];
  industries: string[];
  workMode: string;
  minimumPay: number;
  availability: string;
  workAuth: string;
  linkedin: string;
  profileContext: string;
}

export function terms(value: unknown): string[] {
  return String(value || "").split(/[,;\n]+/).map(item => item.trim()).filter(item => item.length > 1);
}

export function typeFor(job: Listing): string {
  const text = `${job.jobType || ""} ${(job.tags || []).join(" ")} ${job.title || ""} ${job.snippet || ""}`.toLowerCase();
  if (/intern/.test(text)) return "Internship";
  if (/graduate|trainee/.test(text)) return "Graduate / trainee";
  if (/freelance|contractor/.test(text)) return /freelance/.test(text) ? "Freelance" : "Contract";
  if (/part[- ]time/.test(text)) return "Part-time";
  if (/contract/.test(text)) return "Contract";
  if (/full[- ]?time/.test(text)) return "Full-time";
  return job.jobType || "Not specified";
}

export function workModeFor(job: Listing): string {
  const text = `${job.workMode || ""} ${job.location || ""} ${(job.tags || []).join(" ")} ${job.snippet || ""}`.toLowerCase();
  if (/hybrid/.test(text)) return "Hybrid";
  if (/remote/.test(text)) return "Remote";
  if (/on.site|onsite|office based/.test(text)) return "On-site";
  return "Not stated";
}

function skillMatches(job: Listing, prefs: ProfilePrefs): string[] {
  const text = `${job.title} ${job.company} ${job.location} ${job.snippet} ${(job.tags || []).join(" ")}`.toLowerCase();
  return [...prefs.skills, ...prefs.industries]
    .filter((skill, index, all) => all.findIndex(x => x.toLowerCase() === skill.toLowerCase()) === index && text.includes(skill.toLowerCase()));
}

export type RankedListing = Listing & {
  jobType: string;
  workMode: string;
  matchedSkills: string[];
  reasons: string[];
  score: number;
};

export function rankLocal(job: Listing, prefs: ProfilePrefs): RankedListing {
  const text = `${job.title} ${job.company} ${job.location} ${job.snippet} ${(job.tags || []).join(" ")}`.toLowerCase();
  const foundSkills = skillMatches(job, prefs);
  const roleHit = text.includes(prefs.role.toLowerCase()) || prefs.role.toLowerCase().split(/\s+/).some(word => word.length > 3 && text.includes(word));
  const normalizedText = text.replace(/gurugram/g, "gurgaon");
  const normalizedPlace = prefs.location.toLowerCase().replace(/gurugram/g, "gurgaon");
  const workMode = workModeFor(job);
  const locationHit = !normalizedPlace || normalizedText.includes(normalizedPlace) || (workMode === "Remote" && /india|remote/i.test(normalizedText));
  const workModeHit = prefs.workMode === "Any" || workMode === "Not stated" || workMode === prefs.workMode;
  const jobType = typeFor(job);
  const typeHit = !prefs.types.length || prefs.types.includes(jobType) || jobType === "Not specified";
  const expText = `${job.title} ${job.snippet}`.toLowerCase();
  const educationText = `${job.title} ${job.snippet}`.toLowerCase();
  const educationHit = prefs.education === "Any" || prefs.education === "Any education" || educationText.includes(prefs.education.toLowerCase().replace("’", "'")) || (/bachelor/.test(prefs.education.toLowerCase()) && /bachelor|degree|undergraduate/i.test(educationText));
  const expHit = prefs.experience === "Any" || prefs.experience === "Any experience" || expText.includes(prefs.experience.toLowerCase().replace(" years", "")) || job.seniority === "Any level";
  const profileWords = prefs.profileContext.toLowerCase().split(/[^a-z0-9+#.]+/).filter(word => word.length > 3);
  const contextHits = [...new Set(profileWords)].filter(word => text.includes(word)).slice(0, 4);
  const reasons: string[] = [];
  if (roleHit) reasons.push(`The listing title or description aligns with “${prefs.role}”.`);
  if (foundSkills.length) reasons.push(`Your skills appear in the listing: ${foundSkills.join(", ")}.`);
  else if (contextHits.length) reasons.push(`Your profile summary overlaps on: ${contextHits.join(", ")}.`);
  if (locationHit) reasons.push(`The location fits ${prefs.location || "your location preference"}${workMode === "Remote" ? " and the role is marked remote" : ""}.`);
  if (typeHit && prefs.types.length) reasons.push(`Opportunity type fits: ${jobType}.`);
  if (workModeHit && prefs.workMode !== "Any" && workMode !== "Not stated") reasons.push(`Work mode fits your ${prefs.workMode.toLowerCase()} preference.`);
  if (educationHit && prefs.education !== "Any" && prefs.education !== "Any education" && /bachelor|master|doctorate|degree/i.test(educationText)) reasons.push(`The listing mentions education that aligns with ${prefs.education}.`);
  if (prefs.minimumPay && job.salaryValue) reasons.push(job.salaryValue >= prefs.minimumPay ? `Listed pay appears to meet your ₹${prefs.minimumPay.toLocaleString("en-IN")} monthly minimum.` : "The stated pay appears below your minimum; review the original listing.");
  if (prefs.minimumPay && !job.salaryValue) reasons.push("Pay isn’t listed, so your minimum pay preference couldn’t be checked.");
  if (prefs.availability && prefs.availability !== "Any time" && /immediate|start date|available to start/i.test(text)) reasons.push("The listing includes a start or availability detail to compare with your timeline.");
  if (prefs.workAuth !== "Prefer not to say") reasons.push(/visa|sponsor/i.test(text) ? "The listing contains work-authorization or sponsorship details to check." : "The listing doesn’t clearly state sponsorship eligibility.");
  if (!reasons.length) reasons.push("This appeared in a live search for your role and industry. Check the details before applying.");
  let score = 42 + (roleHit ? 16 : 0) + Math.min(foundSkills.length * 7, 21) + Math.min(contextHits.length * 2, 8)
    + (locationHit ? 10 : -6) + (workModeHit ? 5 : -4) + (typeHit ? 5 : -4) + (expHit ? 4 : 0) + (educationHit ? 2 : 0);
  if (prefs.minimumPay && job.salaryValue) score += job.salaryValue >= prefs.minimumPay ? 5 : -6;
  if (prefs.workAuth === "Need visa sponsorship" && /visa|sponsor/i.test(text)) score += 4;
  return {
    ...job,
    jobType, workMode,
    matchedSkills: foundSkills,
    reasons,
    score: Math.max(35, Math.min(98, score))
  };
}
