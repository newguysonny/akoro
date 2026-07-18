"""
lead-scout/audit.py
Website-quality audit. Given a lead's website (or lack of one), produce:
  website_status : none | dead | outdated | ok
  pitch_score    : 0-100 (higher = better pitch target for Akoro)
  reasons        : human-readable list of why they need us
"""
import re
import datetime
import asyncio
import httpx

UA = {"User-Agent": "Mozilla/5.0 (compatible; akoro-lead-scout/1.0)"}
YEAR = datetime.date.today().year

OLD_GENERATORS = re.compile(
    r"frontpage|dreamweaver|joomla!? 1|joomla!? 2|wordpress [1-4]\.|blogger|geocities",
    re.I,
)


def _normalise(url: str) -> str:
    url = (url or "").strip()
    if url and not url.startswith(("http://", "https://")):
        url = "http://" + url
    return url


async def audit_website(client: httpx.AsyncClient, website: str | None) -> dict:
    if not website:
        return {"website_status": "none", "pitch_score": 95,
                "reasons": ["No website found"]}

    url = _normalise(website)
    try:
        r = await client.get(url, headers=UA, timeout=12, follow_redirects=True)
    except Exception:
        return {"website_status": "dead", "pitch_score": 90,
                "reasons": ["Website unreachable"]}

    if r.status_code >= 400:
        return {"website_status": "dead", "pitch_score": 85,
                "reasons": [f"Website returns HTTP {r.status_code}"]}

    html = r.text[:200_000].lower()
    score, reasons = 10, []

    if str(r.url).startswith("http://"):
        score += 20; reasons.append("No HTTPS")
    if "viewport" not in html:
        score += 20; reasons.append("Not mobile-friendly (no viewport meta)")

    years = [int(y) for y in re.findall(r"(?:©|&copy;|copyright)\D{0,12}(19\d{2}|20\d{2})", html)]
    if years and max(years) <= YEAR - 3:
        score += 20; reasons.append(f"Copyright stuck at {max(years)}")

    if OLD_GENERATORS.search(html):
        score += 15; reasons.append("Built with an outdated site generator")
    if "<frameset" in html or "<frame " in html:
        score += 15; reasons.append("Uses HTML framesets")
    if len(html) < 1500:
        score += 10; reasons.append("Near-empty homepage")

    score = min(score, 100)
    status = "outdated" if score >= 50 else "ok"
    if not reasons:
        reasons = ["Website looks reasonably modern"]
    return {"website_status": status, "pitch_score": score, "reasons": reasons}


async def audit_all(leads: list[dict], concurrency: int = 8) -> None:
    """Mutates each lead in place with audit fields."""
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient() as client:
        async def one(lead):
            async with sem:
                lead.update(await audit_website(client, lead.get("website")))
        await asyncio.gather(*(one(l) for l in leads))
