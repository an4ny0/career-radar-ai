import type { Listing, SearchPayload, SearchResponse } from "./types";

const boardGroups: Record<string, string[]> = {
  greenhouse: ["boards.greenhouse.io"],
  lever: ["jobs.lever.co"],
  workday: ["careers.workday.com", "myworkdayjobs.com"],
  company: ["amazon.jobs", "careers.google.com", "jobs.apple.com", "careers.microsoft.com", "careers.nvidia.com", "jobs.intel.com"]
};

export class TinyfishError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export async function tinyfish(url: string, key: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    ...options,
    headers: { "X-API-Key": key, "content-type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(90_000)
  });
  const raw = await response.text();
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw); } catch { data = { error: raw.slice(0, 500) }; }
  if (!response.ok) {
    const errorValue = data?.error as { message?: string } | string | undefined;
    const message =
      (typeof errorValue === "object" && errorValue?.message) ||
      (typeof data?.message === "string" ? data.message : undefined) ||
      `TinyFish returned HTTP ${response.status}.`;
    throw new TinyfishError(message, response.status);
  }
  return data;
}

export function cleanText(value = ""): string {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function unique(values: string[]): string[] {
  return [...new Set(values.map(x => cleanText(x)).filter(Boolean))];
}
function isGenericCareerPage(title = ""): boolean {
  const value = cleanText(title).toLowerCase();
  return /^(careers?|search (?:for )?jobs?)(?:\b|\s|[-–—])/.test(value)
    || /^(software development|software engineering|job categories)$/.test(value)
    || /careers? (?:in|stage\b)/.test(value)
    || /^search jobs?\s*[-–—]/.test(value);
}

function normalizeListing(item: Record<string, unknown>, source = "TinyFish Search"): Listing | null {
  const url = (item.url || item.apply_url || item.link) as string | undefined;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const title = cleanText(String(item.title ?? item.role ?? item.job_title ?? "Opportunity"));
  const snippet = cleanText([item.snippet, item.description, item.text, item.excerpt].filter(Boolean).join(" — ")).slice(0, 700);
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Careers site"; } })();
  const text = `${title} ${snippet} ${host}`;
  const companyMap: Array<[string, RegExp]> = [["Google", /google/i], ["Amazon", /amazon/i], ["Apple", /apple/i], ["Microsoft", /microsoft/i], ["NVIDIA", /nvidia/i], ["Intel", /intel/i], ["Meta", /meta|facebook/i], ["Adobe", /adobe/i], ["Atlassian", /atlassian/i], ["Stripe", /stripe/i], ["Salesforce", /salesforce/i], ["Uber", /uber/i], ["Airbnb", /airbnb/i], ["Datadog", /datadog/i], ["Shopify", /shopify/i], ["LinkedIn", /linkedin/i], ["Chegg", /chegg/i], ["Nationwide", /nationwide/i], ["Visa", /visa/i]];
  const known = companyMap.find(([, regex]) => regex.test(`${host} ${text}`));
  const company = (item.company as string) || known?.[0] || (item.site_name as string) || host.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const locationMatch = text.match(/(?:\*{0,2}locations?\*{0,2}|based in|office in)\s*[:\-]?\s*([^|.;\n]{2,70})/i);
  const locationText = cleanText(locationMatch?.[1] || "Location on listing").split(/(?:\s{2,}|\btime type\b|\bposted on\b|\bjob requisition id\b)/i)[0].slice(0, 48);
  const location = item.location && item.location !== "Location on listing" ? String(item.location) : (/\bremote\b/i.test(text) ? "Remote" : locationText);
  const seniority = /intern(ship)?/i.test(text) ? "Internship" : /senior|staff|principal|lead/i.test(title) ? "Senior" : /junior|entry.level|graduate|associate/i.test(title) ? "Early career" : "Any level";
  const jobType = /intern(ship)?/i.test(text) ? "Internship" : /graduate|trainee/i.test(title) ? "Graduate / trainee" : /freelance/i.test(text) ? "Freelance" : /part[- ]time/i.test(text) ? "Part-time" : /contract/i.test(text) ? "Contract" : /full[- ]?time/i.test(text) ? "Full-time" : "Not specified";
  const workMode = /hybrid/i.test(text) ? "Hybrid" : /remote/i.test(text) ? "Remote" : /on.site|onsite/i.test(text) ? "On-site" : "Not stated";
  const salaryMatch = text.match(/(?:₹|INR|Rs\.?\s*)\s*([\d,]+(?:\.\d+)?)\s*(lpa|lakhs?|k)?/i);
  const salaryValue = salaryMatch ? Number(salaryMatch[1].replace(/,/g, "")) * (/lpa|lakhs?/i.test(salaryMatch[2] || "") ? 100000 / 12 : /^k$/i.test(salaryMatch[2] || "") ? 1000 : 1) : 0;
  const salary = salaryMatch ? `${salaryMatch[0].trim()}${/\/\s*(?:mo|month)/i.test(text) ? "/mo" : " (estimate from listing)"}` : "";
  const posted = cleanText(String(item.published_date ?? "") || text.match(/posted\s+(?:today|yesterday|\d+\s+days?\s+ago|\d+\s+weeks?\s+ago|\d+\s+months?\s+ago)/i)?.[0] || "");
  const tags = unique([...((item.tags as string[]) || []), jobType, workMode, /visa|sponsor/i.test(text) ? "Visa info found" : "Visa not stated"]);
  return { id: url.replace(/[?#].*$/, "").toLowerCase(), title, company, location, seniority, jobType, workMode, salary, salaryValue, posted, snippet: snippet.slice(0, 360), url, source, tags, updatedAt: new Date().toISOString(), score: 0, matched: [] };
}

function rank(listing: Listing, prefs: SearchPayload): Listing {
  const text = `${listing.title} ${listing.company} ${listing.location} ${listing.snippet} ${listing.tags.join(" ")}`.toLowerCase();
  const terms = unique([prefs.role, ...String(prefs.keywords || "").split(/[\s,;]+/), ...String((prefs as unknown as { visa?: string }).visa || "").split(/[\s,;]+/)]).map(t => t.toLowerCase()).filter(t => t.length > 1);
  const matched = terms.filter(t => text.includes(t));
  const loc = String(prefs.location || "").trim().toLowerCase();
  const locationHit = !loc || text.includes(loc) || /remote/i.test(text);
  const seniority = String((prefs as unknown as { seniority?: string }).seniority || "Any");
  const seniorityHit = seniority === "Any" || listing.seniority === seniority || (seniority === "Early career" && /graduate|junior|entry|associate/i.test(text)) || (seniority === "Internship" && /intern/i.test(text));
  listing.score = Math.min(99, 46 + matched.length * 9 + (locationHit ? 14 : 0) + (seniorityHit ? 10 : 0));
  listing.matched = matched;
  return listing;
}

export async function searchJobs(payload: SearchPayload, key: string): Promise<SearchResponse> {
  const role = cleanText(payload.role || "software engineer");
  const location = cleanText(payload.location || "India");
  /* sanitized keyword tokens: "pytorch , pandas ." → pytorch, pandas — punctuation and dupes out, role-relevant terms in,
     capped to keep the search-engine query short instead of a keyword salad */
  const keywordTokens = unique(
    String(payload.keywords || "").replace(/[^A-Za-z0-9+#\-,\s]/g, " ").split(/[\s,;]+/)
  ).slice(0, 8);
  const desiredTypes = Array.isArray(payload.opportunityTypes) ? payload.opportunityTypes.join(" ") : "";
  /* type names, seniority etc. stay OUT of the search query — TinyFish ranks keyword-salad queries at zero;
     types are applied in normalization + the client-side filter instead */
  const buildQuery = (terms: string[]) => cleanText([role, "jobs", location, ...terms, "careers", "hiring"].join(" "));

  const selectedSources = Array.isArray(payload.sources) && payload.sources.length ? payload.sources : Object.keys(boardGroups);
  const domains = unique(selectedSources.flatMap(source => boardGroups[source] || []));
  if (!domains.length) throw new TinyfishError("Choose at least one source group to search.", 400);
  const countryNames: Record<string, string> = { india: "IN", usa: "US", "united states": "US", us: "US", canada: "CA", uk: "GB", "united kingdom": "GB", germany: "DE", france: "FR", australia: "AU", japan: "JP", singapore: "SG" };
  const locationInput = location.toLowerCase();
  const country = Object.entries(countryNames).find(([name]) => locationInput === name || locationInput.endsWith(`, ${name}`))?.[1] || (/\b(US|IN|CA|GB|DE|FR|AU|JP|SG)\b/.exec(location)?.[1] || "US");

  /* attempt 1: role + top-8 sanitized keywords · attempt 2 (auto-fallback): role + top-3 */
  const attempts = [keywordTokens.slice(0, 8), keywordTokens.slice(0, 3), []];
  const searchParams = new URLSearchParams({
    location: country, language: "en", include_domains: domains.join(","),
    purpose: `Find current open job and internship listings matching role: ${role}; location: ${location}; keywords: ${keywordTokens.join(", ") || "none"}. Prioritize company career pages and application pages.` + (desiredTypes ? ` Focus on: ${desiredTypes}.` : "")
  });
  searchParams.delete("query");

  let searchRows: Array<Record<string, unknown>> = [];
  let usedQuery = "";
  for (const terms of attempts) {
    usedQuery = buildQuery(terms);
    searchParams.set("query", usedQuery);
    const searchResult = (await tinyfish(`https://api.search.tinyfish.ai?${searchParams}`, key)) as { results?: Array<Record<string, unknown>> };
    searchRows = Array.isArray(searchResult.results) ? searchResult.results : [];
    if (process.env.NODE_ENV !== "production") {
      console.log(`[radar-search] attempt query="${usedQuery}" → rows=${searchRows.length}`);
      if (searchRows[0]) console.log(`[radar-search] row0 sample:`, JSON.stringify(searchRows[0]).slice(0, 400));
    }
    if (searchRows.length) break;
  }
  if (process.env.NODE_ENV !== "production") {
    console.log(`[radar-search] final query="${usedQuery}" country=${country} domains=${domains.join(",")} rows=${searchRows.length}`);
  }
  const seen = new Set<string>();
  const candidates = searchRows
    .filter(row => !isGenericCareerPage(String(row.title)))
    .map(row => normalizeListing(row))
    .filter((row): row is Listing => row !== null)
    .filter(row => {
      if (seen.has(row.id)) return false;
      seen.add(row.id); return true;
    })
    .slice(0, 10);

  let fetched: Array<Record<string, unknown>> = [];
  let fetchErrors: unknown[] = [];
  if (candidates.length) {
    const fetchResult = (await tinyfish("https://api.fetch.tinyfish.ai", key, {
      method: "POST",
      body: JSON.stringify({ urls: candidates.map(row => row.url), format: "markdown", ttl: 0, purpose: "Confirm this search result is an active job listing and extract role, location, job type, and application details." })
    })) as { results?: Array<Record<string, unknown>>; errors?: unknown[] };
    fetched = Array.isArray(fetchResult.results) ? fetchResult.results : [];
    fetchErrors = Array.isArray(fetchResult.errors) ? fetchResult.errors : [];
  }
  const pageByUrl = new Map(fetched.map(page => [String(page.url || page.final_url).replace(/[?#].*$/, "").toLowerCase(), page]));
  const combined = candidates.map(candidate => {
    const page = pageByUrl.get(candidate.id);
    const pageText = cleanText(typeof page?.text === "string" ? (page.text as string) : "");
    const title = cleanText(String(page?.title ?? "") || candidate.title);
    if (isGenericCareerPage(title)) return null;
    const listing = normalizeListing({ ...candidate, title, description: pageText.slice(0, 1200) || candidate.snippet, company: candidate.company }, "TinyFish Search + Fetch");
    if (!listing) return null;
    listing.fetchStatus = page ? "Page read live" : "Search snippet only";
    return rank(listing, payload);
  });

  const normalized = new Map<string, Listing>();
  for (const listing of combined.filter((row): row is Listing => Boolean(row))) {
    const key = `${listing.company.toLowerCase()}|${listing.title.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const old = normalized.get(key);
    if (!old || listing.score > old.score) normalized.set(key, listing);
  }
  const all = [...normalized.values()];
  const results = [...all].sort((a, b) => b.score - a.score).slice(0, 10);
  if (process.env.NODE_ENV !== "production") {
    console.log(`[radar-search] considered=${searchRows.length} generic-filtered→candidates=${candidates.length} fetched=${fetched.length} fetchErrors=${fetchErrors.length} final=${results.length}`);
  }
  const fallback = results.some(row => !row.matched.length || /not stated/i.test(row.workMode));
  return {
    query: usedQuery, results, totalFound: all.length, considered: searchRows.length, fetched: fetched.length, fallback,
    errors: fetchErrors.length, searchedAt: new Date().toISOString(),
    providers: ["TinyFish Search", ...(candidates.length ? ["TinyFish Fetch"] : [])],
    message: fallback ? "Some listing details may not match every preference. These are ranked live candidates; review each source page." : results.length ? "Ranked live openings. Open the source listing to apply." : "No listings found on the selected sources. Try broader keywords or another source group."
  };
}
