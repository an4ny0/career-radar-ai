import { NextResponse } from "next/server";
import { cleanText, searchJobs, TinyfishError } from "@/lib/search";
import type { SearchPayload } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as SearchPayload;
    /* the radar is strictly bring-your-own-key: the key must come from the user's session */
    const key = cleanText(input.apiKey || "");
    if (!key) {
      return NextResponse.json({ error: "Add a TinyFish API key in the key field to search live opportunities." }, { status: 401 });
    }
    const data = await searchJobs(input, key);
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = error instanceof TinyfishError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error(`[radar-search] failed (HTTP ${status}): ${message}`);
    return NextResponse.json({ error: message }, { status });
  }
}
