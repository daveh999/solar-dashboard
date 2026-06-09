// Netlify Function: read-only Home Assistant proxy for the solar dashboard.
// Token lives in Netlify env vars (HA_URL, HA_TOKEN) and never reaches the browser.
// Only the whitelisted sensors below can ever be read. No write paths exist.

const WHITELIST = [
  "sensor.energy_production_today",          // Forecast.Solar garage (ESE)
  "sensor.energy_production_today_2",        // Forecast.Solar house (WSW)
  "sensor.myenergi_my_home_generated_today_2", // actual generation (cumulative kWh)
  "sensor.solar_calibration_ratio_30d",      // 30-day calibration ratio
  "sensor.solar_hourly_forecast_adjusted",   // cloud-adjusted hourly forecast
  "sensor.solcast_pv_forecast_forecast_today", // Solcast with confidence bands
];

const HISTORY_ENTITY = "sensor.myenergi_my_home_generated_today_2";
const TZ = "Europe/London";

// ISO timestamp for local midnight in the HA timezone, with correct UTC offset.
function localMidnightISO() {
  const now = new Date();
  const day = now.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
  const offsetName = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    timeZoneName: "shortOffset",
  })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName").value; // e.g. "GMT+1"
  const m = offsetName.match(/GMT([+-]\d+)(?::(\d+))?/);
  const hours = m ? parseInt(m[1], 10) : 0;
  const mins = m && m[2] ? parseInt(m[2], 10) : 0;
  const sign = hours < 0 || Object.is(hours, -0) ? "-" : "+";
  const pad = (n) => String(Math.abs(n)).padStart(2, "0");
  return `${day}T00:00:00${sign}${pad(hours)}:${pad(mins)}`;
}

async function ha(path, base, token) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HA ${res.status} on ${path}`);
  return res.json();
}

export default async function handler() {
  const base = (process.env.HA_URL || "").replace(/\/$/, "");
  const token = process.env.HA_TOKEN;
  if (!base || !token) {
    return Response.json(
      { error: "HA_URL and HA_TOKEN must be set in Netlify environment variables" },
      { status: 500 }
    );
  }

  try {
    const midnight = localMidnightISO();

    const [states, history] = await Promise.all([
      Promise.all(WHITELIST.map((id) => ha(`/api/states/${id}`, base, token))),
      ha(
        `/api/history/period/${encodeURIComponent(midnight)}` +
          `?filter_entity_id=${HISTORY_ENTITY}&minimal_response&no_attributes`,
        base,
        token
      ),
    ]);

    const byId = Object.fromEntries(states.map((s) => [s.entity_id, s]));
    const num = (id) => {
      const v = parseFloat(byId[id]?.state);
      return Number.isFinite(v) ? v : null;
    };

    const adjusted = byId["sensor.solar_hourly_forecast_adjusted"] || {};
    const solcast = byId["sensor.solcast_pv_forecast_forecast_today"] || {};

    // Cumulative kWh samples for the actual-generation curve.
    const actualSeries = (history?.[0] || [])
      .map((p) => ({
        t: p.last_changed || p.last_updated,
        v: parseFloat(p.state),
      }))
      .filter((p) => Number.isFinite(p.v));

    const payload = {
      generatedAt: new Date().toISOString(),
      timezone: TZ,
      forecastSolar: {
        garageKwh: num("sensor.energy_production_today"),
        houseKwh: num("sensor.energy_production_today_2"),
      },
      solcast: {
        estimateKwh: num("sensor.solcast_pv_forecast_forecast_today"),
        estimate10Kwh: solcast.attributes?.estimate10 ?? null,
        estimate90Kwh: solcast.attributes?.estimate90 ?? null,
        hourly: (solcast.attributes?.detailedHourly || []).map((h) => ({
          t: h.period_start,
          kwh: h.pv_estimate,
          kwh10: h.pv_estimate10,
          kwh90: h.pv_estimate90,
        })),
      },
      adjusted: {
        totalKwh: num("sensor.solar_hourly_forecast_adjusted"),
        hourlyWh: adjusted.attributes?.hourly_forecast_wh || {},
        rawWh: adjusted.attributes?.raw_forecast_wh || {},
        cloudCover: adjusted.attributes?.cloud_cover_by_hour || {},
      },
      actual: {
        todayKwh: num("sensor.myenergi_my_home_generated_today_2"),
        cumulativeSeries: actualSeries,
      },
      calibrationRatio30d: num("sensor.solar_calibration_ratio_30d"),
    };

    return Response.json(payload, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 502 });
  }
}

export const config = { path: "/api/solar" };
