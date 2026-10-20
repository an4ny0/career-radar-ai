export interface Listing {
  id: string;
  title: string;
  company: string;
  location: string;
  seniority: string;
  jobType: string;
  workMode: string;
  salary: string;
  salaryValue: number;
  posted: string;
  snippet: string;
  url: string;
  source: string;
  tags: string[];
  updatedAt: string;
  score: number;
  matched: string[];
  fetchStatus?: string;
}

export interface SearchPayload {
  role: string;
  location: string;
  keywords: string;
  opportunityTypes: string[];
  sources: string[];
  apiKey?: string;
}

export interface SearchResponse {
  query: string;
  results: Listing[];
  totalFound: number;
  considered: number;
  fetched: number;
  fallback: boolean;
  errors: number;
  searchedAt: string;
  providers: string[];
  message: string;
}
