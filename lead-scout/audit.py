"""
lead-scout/audit.py
Website-quality audit + contact enrichment. For each lead:
  website_status : none | dead | outdated | ok
  pitch_score    : 0-100 (higher = better pitch target for Akoro)
  reasons        : human-readable list of why they need us
And, scraped from the lead's own website (a legitimate one-page fetch of a
page they publish publicly):
  email, phone_found, facebook, instagram, twitter, linkedin
so the sales team has something to reach out on.
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

SOCIAL_PATTERNS = {
    "facebook":  r'https?://(?:www\.)?(?:facebook|fb)\.com/[^\s"\'<>]+',
    "instagram": r'https?://(?:www\.)?instagram\.com/[^\s"\'<>]+',
    "twitter":   r'https?://(?:www\.)?(?:twitter|x)\.com/[^\s"\'<>]+',
    "linkedin":  r'https?://(?:www\.)?linkedin\.com/[^\s"\'<>]+',
}
SOCIAL_KEYS = ["email", "phone_found", "facebook", "instagram", "twitter", "linkedin"]
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
TEL_RE   = re.compile(r"tel:([+0-9()\-\s]{7,})", re.I)
JUNK_LINK = re.compile(r"/sharer|/share|intent/|/plugins/|/tr\?|/login", re.I)


def _empty_contacts() -> dict:
    return {k: None for k in SOCIAL_KEYS}


def extract_contacts(html: str) -> dict:
    out = _empty_contacts()
    for key, pat in SOCIAL_PATTERNS.items():
        for m in re.finditer(pat, html, re.I):
            url = m.group(0).rstrip("\"')/ ")
            if not JUNK_LINK.search(url):
                out[key] = url
                break
    # Email — prefer a mailto: link, else the first plausible address.
    mailto = re.search(r'mailto:([^\s"\'<>?]+@[^\s"\'<>?]+)', html, re.I)
    if mailto:
        out["email"] = mailto.group(1)
    else:
        em = EMAIL_RE.search(html)
        if em and not em.group(0).lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
            out["email"] = em.group(0)
    tel = TEL_RE.search(html)
    if tel:
        out["phone_found"] = re.sub(r"\s+", " ", tel.group(1)).strip()
    return out


def _normalise(url: str) -> str:
    url = (url or "").strip()
    if url and not url.startswith(("http://", "https://")):
        url = "http://" + url
    return url


async def audit_website(client: httpx.AsyncClient, website: str | None) -> dict:
    base = {"website_status": "none", "pitch_score": 95,
            "reasons": ["No website found"], **_empty_contacts()}
    if not website:
        return base

    url = _normalise(website)
    try:
        r = await client.get(url, headers=UA, timeout=12, follow_redirects=True)
    except Exception:
        return {**base, "website_status": "dead", "pitch_score": 90, "reasons": ["Website unreachable"]}

    if r.status_code >= 400:
        return {**base, "website_status": "dead", "pitch_score": 85, "reasons": [f"Website returns HTTP {r.status_code}"]}

    html = r.text[:300_000]
    low = html.lower()
    score, reasons = 10, []

    if str(r.url).startswith("http://"):
        score += 20; reasons.append("No HTTPS")
    if "viewport" not in low:
        score += 20; reasons.append("Not mobile-friendly (no viewport meta)")

    years = [int(y) for y in re.findall(r"(?:©|&copy;|copyright)\D{0,12}(19\d{2}|20\d{2})", low)]
    if years and max(years) <= YEAR - 3:
        score += 20; reasons.append(f"Copyright stuck at {max(years)}")
    if OLD_GENERATORS.search(low):
        score += 15; reasons.append("Built with an outdated site generator")
    if "<frameset" in low or "<frame " in low:
        score += 15; reasons.append("Uses HTML framesets")
    if len(low) < 1500:
        score += 10; reasons.append("Near-empty homepage")

    score = min(score, 100)
    status = "outdated" if score >= 50 else "ok"
    if not reasons:
        reasons = ["Website looks reasonably modern"]

    return {"website_status": status, "pitch_score": score, "reasons": reasons,
            **extract_contacts(html)}


async def audit_all(leads: list[dict], concurrency: int = 8) -> None:
    """Mutate each lead in place with audit + enrichment fields."""
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient() as client:
        async def one(lead):
            async with sem:
                res = await audit_website(client, lead.get("website"))
            phone_found = res.pop("phone_found", None)
            # Don't clobber a phone the source already gave us.
            for k, v in res.items():
                if v is not None or k not in lead:
                    lead[k] = v
            if not lead.get("phone") and phone_found:
                lead["phone"] = phone_found
        await asyncio.gather(*(one(l) for l in leads))
