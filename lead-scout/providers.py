"""
lead-scout/providers.py
Lead discovery providers. Each returns a list of dicts:
  { name, category, address, phone, website, source }

Implemented (legitimate access only):
  osm           — OpenStreetMap Overpass API. Free, no key, best coverage for
                  schools in NG/GH and most of the world.
  google_maps   — Google Places Text Search (+ Details). Needs GOOGLE_MAPS_API_KEY.
  yelp          — Yelp Fusion API. Needs YELP_API_KEY.

Deliberately NOT implemented (blocked by platform ToS / login walls):
  yellow_pages, instagram, facebook, twitter — requesting these targets adds a
  warning to the job instead of silently returning nothing.
"""
import os
import asyncio
import httpx

UA = {"User-Agent": "akoro-lead-scout/1.0 (partnerships@akoro.app)"}

# business_type keyword → OSM amenity regex
OSM_TYPE_MAP = [
    (("school", "primary", "secondary"), "school"),
    (("college",), "college"),
    (("university",), "university"),
    (("kindergarten", "nursery", "creche", "montessori"), "kindergarten"),
    (("tutor", "lesson", "coaching"), "tutoring|prep_school|language_school"),
]


def osm_amenity_for(business_type: str) -> str:
    t = (business_type or "").lower()
    parts = [rx for keys, rx in OSM_TYPE_MAP if any(k in t for k in keys)]
    # Default to the full education set — the whole point of the tool.
    return "|".join(parts) if parts else "school|college|kindergarten|university"


async def geocode(client: httpx.AsyncClient, location: str):
    """Location string → (south, west, north, east) bounding box via Nominatim."""
    r = await client.get(
        "https://nominatim.openstreetmap.org/search",
        params={"q": location, "format": "json", "limit": 1},
        headers=UA, timeout=20,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        raise ValueError(f"Could not find location '{location}'")
    bb = rows[0]["boundingbox"]  # [south, north, west, east] as strings
    return float(bb[0]), float(bb[2]), float(bb[1]), float(bb[3])


async def fetch_osm(business_type: str, location: str, limit: int) -> list[dict]:
    amenity = osm_amenity_for(business_type)
    async with httpx.AsyncClient() as client:
        s, w, n, e = await geocode(client, location)
        query = f"""
        [out:json][timeout:60];
        nwr["amenity"~"{amenity}"]({s},{w},{n},{e});
        out center tags {min(limit * 3, 1200)};
        """
        r = await client.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": query}, headers=UA, timeout=90,
        )
        r.raise_for_status()
        leads = []
        for el in r.json().get("elements", []):
            tags = el.get("tags", {})
            name = tags.get("name")
            if not name:
                continue
            addr = ", ".join(filter(None, [
                tags.get("addr:housenumber"), tags.get("addr:street"),
                tags.get("addr:suburb"), tags.get("addr:city") or tags.get("addr:town"),
                tags.get("addr:state"),
            ])) or None
            leads.append({
                "name": name,
                "category": tags.get("amenity", "school"),
                "address": addr,
                "phone": tags.get("phone") or tags.get("contact:phone"),
                "website": tags.get("website") or tags.get("contact:website"),
                "source": "osm",
            })
            if len(leads) >= limit:
                break
        return leads


async def fetch_google_maps(business_type: str, location: str, limit: int) -> list[dict]:
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key:
        raise RuntimeError("GOOGLE_MAPS_API_KEY not set")
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "https://maps.googleapis.com/maps/api/place/textsearch/json",
            params={"query": f"{business_type or 'schools'} in {location}", "key": key},
            timeout=30,
        )
        r.raise_for_status()
        results = r.json().get("results", [])[:limit]

        async def detail(p):
            try:
                d = await client.get(
                    "https://maps.googleapis.com/maps/api/place/details/json",
                    params={"place_id": p["place_id"], "key": key,
                            "fields": "website,formatted_phone_number"},
                    timeout=20,
                )
                dd = d.json().get("result", {})
            except Exception:
                dd = {}
            return {
                "name": p.get("name"),
                "category": ", ".join(p.get("types", [])[:2]) or "school",
                "address": p.get("formatted_address"),
                "phone": dd.get("formatted_phone_number"),
                "website": dd.get("website"),
                "source": "google_maps",
            }

        return list(await asyncio.gather(*(detail(p) for p in results)))


async def fetch_yelp(business_type: str, location: str, limit: int) -> list[dict]:
    key = os.environ.get("YELP_API_KEY")
    if not key:
        raise RuntimeError("YELP_API_KEY not set")
    async with httpx.AsyncClient() as client:
        r = await client.get(
            "https://api.yelp.com/v3/businesses/search",
            params={"term": business_type or "schools", "location": location,
                    "limit": min(limit, 50)},
            headers={"Authorization": f"Bearer {key}"}, timeout=30,
        )
        r.raise_for_status()
        return [{
            "name": b.get("name"),
            "category": ", ".join(c["title"] for c in b.get("categories", [])[:2]),
            "address": ", ".join(b.get("location", {}).get("display_address", [])),
            "phone": b.get("display_phone"),
            "website": None,  # Yelp API does not expose the business website
            "source": "yelp",
        } for b in r.json().get("businesses", [])]


PROVIDERS = {
    "osm": fetch_osm,
    "google_maps": fetch_google_maps,
    "yelp": fetch_yelp,
}

UNSUPPORTED = {
    "yellow_pages": "Yellow Pages has no official API and prohibits scraping in its ToS",
    "instagram":    "Instagram blocks scraping (login wall + ToS); use the official Graph API with a partner account",
    "facebook":     "Facebook blocks scraping (login wall + ToS); use the official Graph API with a partner account",
    "twitter":      "X/Twitter requires the paid official API for search",
}
