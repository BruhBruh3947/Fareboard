/* ============================================================
   FAREBOARD — full site (Departures + World), one server.
   Free data via Travelpayouts (Aviasales) cached API.
   Works with sample data until you add a token, so it never
   shows a blank page.

   Env vars (set on your host, e.g. Render):
     TP_TOKEN   - your Travelpayouts API token  (required for live data)
     TP_MARKER  - your Travelpayouts marker/affiliate id (optional, for booking links)
   ============================================================ */

require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TP_TOKEN;
const MARKER = process.env.TP_MARKER || "";

app.use(express.static(__dirname));

/* some airports are searched by their CITY code on Aviasales */
const TO_CITY = {
  JFK: "NYC", EWR: "NYC", LGA: "NYC", LHR: "LON", LGW: "LON", LCY: "LON",
  HND: "TYO", NRT: "TYO", FCO: "ROM", CDG: "PAR", ORY: "PAR",
};
const cityCode = (c) => TO_CITY[(c || "").toUpperCase()] || (c || "").toUpperCase();

/* IATA -> {iso2, country, lat, lng} — fetched once from Travelpayouts, cached.
   Small built-in fallback so the globe still works if the fetch fails. */
let AIRPORTS = null;
const FALLBACK_AIRPORTS = {
  LON: { iso2: "GB", country: "United Kingdom" }, PAR: { iso2: "FR", country: "France" },
  ROM: { iso2: "IT", country: "Italy" }, MAD: { iso2: "ES", country: "Spain" },
  BCN: { iso2: "ES", country: "Spain" }, AMS: { iso2: "NL", country: "Netherlands" },
  FRA: { iso2: "DE", country: "Germany" }, IST: { iso2: "TR", country: "Türkiye" },
  DXB: { iso2: "AE", country: "United Arab Emirates" }, DOH: { iso2: "QA", country: "Qatar" },
  TYO: { iso2: "JP", country: "Japan" }, ICN: { iso2: "KR", country: "South Korea" },
  SIN: { iso2: "SG", country: "Singapore" }, BKK: { iso2: "TH", country: "Thailand" },
  HKG: { iso2: "CN", country: "China" }, DEL: { iso2: "IN", country: "India" },
  SYD: { iso2: "AU", country: "Australia" }, MEX: { iso2: "MX", country: "Mexico" },
  GRU: { iso2: "BR", country: "Brazil" }, EZE: { iso2: "AR", country: "Argentina" },
  YYZ: { iso2: "CA", country: "Canada" }, CPT: { iso2: "ZA", country: "South Africa" },
  CAI: { iso2: "EG", country: "Egypt" }, NBO: { iso2: "KE", country: "Kenya" },
  LAX: { iso2: "US", country: "United States" }, MIA: { iso2: "US", country: "United States" },
};
async function loadAirports() {
  if (AIRPORTS) return AIRPORTS;
  AIRPORTS = { ...FALLBACK_AIRPORTS };
  try {
    const r = await fetch("https://api.travelpayouts.com/data/en/airports.json");
    const list = await r.json();
    for (const a of list) {
      if (a.code && a.country_code) {
        AIRPORTS[a.code] = {
          iso2: a.country_code,
          country: a.country_code,
          lat: a.coordinates?.lat,
          lng: a.coordinates?.lon,
        };
      }
    }
  } catch (e) {
    console.log("airports.json fetch failed, using fallback:", e.message);
  }
  return AIRPORTS;
}

/* ---------- API: cheapest fares for a route (Departures page) ---------- */
app.get("/api/search", async (req, res) => {
  if (!TOKEN) return res.json({ sample: true });
  const { from, to, month, oneway } = req.query;
  if (!from || !to) return res.status(400).json({ error: "Need from and to." });
  const origin = cityCode(from), dest = cityCode(to);
  const url = new URL("https://api.travelpayouts.com/v1/prices/cheap");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", dest);
  if (month) url.searchParams.set("depart_date", month); // YYYY-MM
  url.searchParams.set("currency", "usd");
  url.searchParams.set("token", TOKEN);
  try {
    const r = await fetch(url);
    const data = await r.json();
    const bucket = (data.data && data.data[dest]) || {};
    const flights = Object.values(bucket).map((o) => ({
      airline: o.airline, flightNo: (o.airline || "") + (o.flight_number || ""),
      price: o.price, stops: o.number_of_changes,
      depart: o.departure_at, ret: o.return_at,
    })).sort((a, b) => a.price - b.price);
    const link = `https://www.aviasales.com/search?origin_iata=${origin}&destination_iata=${dest}${MARKER ? "&marker=" + MARKER : ""}`;
    res.json({ flights, cheapest: flights[0]?.price ?? null, meta: { origin, dest }, bookUrl: link });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ---------- API: cheapest price per COUNTRY from an origin (World page) ---------- */
app.get("/api/explore", async (req, res) => {
  if (!TOKEN) return res.json({ sample: true });
  const { from } = req.query;
  if (!from) return res.status(400).json({ error: "Need a from airport." });
  const origin = cityCode(from);
  const airports = await loadAirports();
  const url = new URL("https://api.travelpayouts.com/aviasales/v3/get_latest_prices");
  url.searchParams.set("origin", origin);
  url.searchParams.set("currency", "usd");
  url.searchParams.set("one_way", "false");
  url.searchParams.set("limit", "1000");
  url.searchParams.set("token", TOKEN);
  try {
    const r = await fetch(url);
    const data = await r.json();
    const cheapestByCountry = {};
    for (const row of data.data || []) {
      const info = airports[row.destination];
      if (!info || !info.iso2) continue;
      const cur = cheapestByCountry[info.iso2];
      if (!cur || row.value < cur.price) {
        cheapestByCountry[info.iso2] = { iso2: info.iso2, price: row.value, dest: row.destination };
      }
    }
    res.json({ countries: Object.values(cheapestByCountry), meta: { origin } });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/world", (req, res) => res.sendFile(path.join(__dirname, "world.html")));

app.listen(PORT, () => {
  console.log(`Fareboard on http://localhost:${PORT}`);
  if (!TOKEN) console.log("No TP_TOKEN set → running on sample data. Add one for live prices.");
});
