"""
lead-scout — Akoro marketing lead-generation service.

Discovers schools (or other businesses) in a location via legitimate sources
(OpenStreetMap, Google Places, Yelp), audits each lead's website quality, and
scores how good a pitch target it is for Akoro. Jobs run async; results are
downloadable as CSV.

Run:      uvicorn main:app --port 8100
Auth:     if LEAD_SCOUT_SECRET is set, requests must carry
          X-Internal-Secret: <secret> (the akoro-api proxy adds it).
Persist:  jobs + CSVs under ./data (survive restarts).
"""
import os
import csv
import io
import json
import uuid
import asyncio
import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Header, Response
from pydantic import BaseModel, Field

from providers import PROVIDERS, UNSUPPORTED
from audit import audit_all

DATA = Path(__file__).parent / "data"
DATA.mkdir(exist_ok=True)

app = FastAPI(title="akoro-lead-scout")
SECRET = os.environ.get("LEAD_SCOUT_SECRET", "")

CSV_COLUMNS = ["name", "category", "address", "phone", "email", "website",
               "website_status", "pitch_score", "reasons",
               "facebook", "instagram", "twitter", "linkedin", "source"]

# Accepted CSV header aliases → our field names (case-insensitive).
COLUMN_ALIASES = {
    "name": "name", "school": "name", "school_name": "name", "school name": "name",
    "institution": "name", "business": "name",
    "website": "website", "url": "website", "web": "website", "site": "website",
    "phone": "phone", "telephone": "phone", "tel": "phone", "mobile": "phone", "contact": "phone",
    "email": "email", "e-mail": "email",
    "address": "address", "location": "address", "town": "address", "city": "address",
    "category": "category", "type": "category",
}


class JobRequest(BaseModel):
    business_type: str = Field(default="Schools", max_length=120)
    location: str = Field(min_length=2, max_length=160)
    targets: list[str] = Field(default=["osm"])
    limit: int = Field(default=100, ge=1, le=500)
    weak_websites_only: bool = False


class ImportRequest(BaseModel):
    csv: str = Field(min_length=1)
    weak_websites_only: bool = False
    limit: int = Field(default=500, ge=1, le=2000)


def check_auth(secret: str | None):
    if SECRET and secret != SECRET:
        raise HTTPException(401, "Bad or missing X-Internal-Secret")


def job_path(job_id: str) -> Path:
    return DATA / f"{job_id}.json"


def save_job(job: dict):
    job_path(job["id"]).write_text(json.dumps(job))


def load_job(job_id: str) -> dict:
    p = job_path(job_id)
    if not p.exists():
        raise HTTPException(404, "Job not found")
    return json.loads(p.read_text())


async def finalize(job: dict, leads: list[dict], limit: int, weak_only: bool, warnings: list[str]):
    """Shared tail: dedupe → cap → audit+enrich → filter → sort → done."""
    seen, unique = set(), []
    for l in leads:
        k = (l.get("name") or "").strip().lower()
        if k and k not in seen:
            seen.add(k)
            unique.append(l)
    unique = unique[:limit]

    job.update(status="auditing", found=len(unique), warnings=warnings)
    save_job(job)

    try:
        await audit_all(unique)
    except Exception as e:
        warnings.append(f"audit: {e}")

    if weak_only:
        unique = [l for l in unique if l.get("pitch_score", 0) >= 50]
    unique.sort(key=lambda l: -l.get("pitch_score", 0))

    job.update(status="done", leads=unique, found=len(unique), warnings=warnings,
               finished_at=datetime.datetime.utcnow().isoformat() + "Z")
    save_job(job)


async def run_job(job: dict, req: JobRequest):
    leads, warnings = [], []
    for target in req.targets:
        if target in UNSUPPORTED:
            warnings.append(f"{target}: {UNSUPPORTED[target]}")
            continue
        fn = PROVIDERS.get(target)
        if not fn:
            warnings.append(f"{target}: unknown target")
            continue
        try:
            got = await fn(req.business_type, req.location, req.limit)
            leads.extend(got)
            if not got:
                warnings.append(f"{target}: no results")
        except Exception as e:
            warnings.append(f"{target}: {e}")
    await finalize(job, leads, req.limit, req.weak_websites_only, warnings)


def parse_csv(text: str) -> list[dict]:
    """Parse an uploaded school-list CSV into lead dicts, mapping header aliases."""
    import csv as _csv
    import io as _io
    reader = _csv.DictReader(_io.StringIO(text))
    leads = []
    for raw in reader:
        lead = {"source": "import", "category": "school"}
        for header, value in raw.items():
            if header is None:
                continue
            field = COLUMN_ALIASES.get(header.strip().lower())
            if field and value and str(value).strip():
                lead[field] = str(value).strip()
        if lead.get("name"):
            leads.append(lead)
    return leads


async def run_import(job: dict, req: ImportRequest):
    warnings = []
    try:
        leads = parse_csv(req.csv)
    except Exception as e:
        leads, warnings = [], [f"csv parse: {e}"]
    if not leads:
        warnings.append("No rows with a recognisable name column were found")
    await finalize(job, leads, req.limit, req.weak_websites_only, warnings)


@app.get("/health")
async def health():
    keys = {"google_maps": bool(os.environ.get("GOOGLE_MAPS_API_KEY")),
            "yelp": bool(os.environ.get("YELP_API_KEY")), "osm": True}
    return {"ok": True, "providers": keys}


@app.post("/jobs", status_code=201)
async def create_job(req: JobRequest, x_internal_secret: str | None = Header(None)):
    check_auth(x_internal_secret)
    job = {"id": uuid.uuid4().hex[:12], "status": "running",
           "request": req.model_dump(), "found": 0, "warnings": [], "leads": [],
           "created_at": datetime.datetime.utcnow().isoformat() + "Z"}
    save_job(job)
    asyncio.create_task(run_job(job, req))
    return {"id": job["id"], "status": job["status"]}


@app.post("/jobs/import", status_code=201)
async def create_import(req: ImportRequest, x_internal_secret: str | None = Header(None)):
    check_auth(x_internal_secret)
    job = {"id": uuid.uuid4().hex[:12], "status": "running", "request": {"mode": "import"},
           "found": 0, "warnings": [], "leads": [],
           "created_at": datetime.datetime.utcnow().isoformat() + "Z"}
    save_job(job)
    asyncio.create_task(run_import(job, req))
    return {"id": job["id"], "status": job["status"]}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str, x_internal_secret: str | None = Header(None)):
    check_auth(x_internal_secret)
    job = load_job(job_id)
    # Keep polling light: cap the lead preview, CSV has everything.
    preview = dict(job)
    preview["leads"] = job.get("leads", [])[:200]
    return preview


@app.get("/jobs/{job_id}/csv")
async def get_csv(job_id: str, x_internal_secret: str | None = Header(None)):
    check_auth(x_internal_secret)
    job = load_job(job_id)
    if job["status"] != "done":
        raise HTTPException(409, f"Job is still {job['status']}")
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    w.writeheader()
    for lead in job.get("leads", []):
        row = dict(lead)
        row["reasons"] = "; ".join(row.get("reasons") or [])
        w.writerow(row)
    return Response(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="leads-{job_id}.csv"'},
    )
