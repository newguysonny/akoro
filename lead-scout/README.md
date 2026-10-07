# lead-scout

Marketing lead-generation service for Akoro. Finds schools (or other
businesses) in a location, audits each one's website quality, and scores how
good a pitch target it is — the goal being schools with **no website or an
outdated one**. Results download as CSV from the admin app (Marketing page).

## Sources
| Target        | How                              | Needs                 |
|---------------|----------------------------------|-----------------------|
| `osm`         | OpenStreetMap Overpass + Nominatim | nothing (free)      |
| `google_maps` | Google Places API                | `GOOGLE_MAPS_API_KEY` |
| `yelp`        | Yelp Fusion API                  | `YELP_API_KEY`        |
| yellow_pages / instagram / facebook / twitter | **not scraped** — ToS/login walls; requesting them adds a job warning | official API access |

## Run
    pip install -r requirements.txt
    LEAD_SCOUT_SECRET=changeme uvicorn main:app --port 8100

The akoro-api proxies to this service (`LEAD_SCOUT_URL`, `LEAD_SCOUT_SECRET`
in its env). Jobs and CSVs persist under `./data/`.
