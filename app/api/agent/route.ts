import { NextResponse } from "next/server";
import { cleanText, tinyfish, TinyfishError } from "@/lib/search";
import type { Listing } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as { listing?: Partial<Listing>; apiKey?: string };
    /* strictly bring-your-own-key here too */
    const key = cleanText(input.apiKey || "");
    if (!key) {
      return NextResponse.json({ error: "Add a TinyFish API key to run agent checks." }, { status: 401 });
    }
    const listing = input.listing || {};
    let target: URL;
    try { target = new URL(String(listing.url)); } catch {
      return NextResponse.json({ error: "Select a valid result URL first." }, { status: 400 });
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return NextResponse.json({ error: "Only public HTTP(S) listings can be checked." }, { status: 400 });
    }
    const goal = `Inspect this job listing page and verify whether it is a real job or internship opening. Return a concise JSON object with: title, company, location, employment_type, active (true/false/unknown), apply_url, and evidence (one short sentence). Do not invent missing details. Listing to inspect: ${listing.title || "job opportunity"}.`;
    const result = (await tinyfish("https://agent.tinyfish.ai/v1/automation/run", key, {
      method: "POST",
      body: JSON.stringify({ url: target.href, goal })
    })) as Record<string, unknown>;
    return NextResponse.json({ result: result.result ?? result, status: result.status || "COMPLETED", runId: result.run_id || result.runId || null }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = error instanceof TinyfishError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status });
  }
}
