# Sheepridge Solar Dashboard

Forecast vs actual solar generation, live from Home Assistant via Nabu Casa,
deployed on Netlify. The HA access token never reaches the browser — a Netlify
Function (`/api/solar`) proxies requests server-side and can only read six
whitelisted sensors. There are no write paths.

## Files

- `index.html` — the dashboard (Chart.js, no build step)
- `netlify/functions/solar.js` — read-only HA proxy
- `netlify.toml` — Netlify config

## Setup

1. **Create a new GitHub repo** (e.g. `solar-dashboard`), copy these files in,
   and push using the usual workflow:

   ```
   git add . && git commit -m "Solar dashboard v1" && git push
   ```

2. **Connect the repo to Netlify** — Add new site → Import an existing
   project → GitHub → pick the repo → Deploy. No build settings needed.

3. **Create a Home Assistant long-lived access token** (do this yourself in
   HA — never paste the token into a chat): HA → click your user avatar
   (bottom-left) → **Security** tab → **Long-lived access tokens** →
   Create token. Name it something like `netlify-solar-dashboard` so it's
   identifiable and revocable on its own.

4. **Add two environment variables in Netlify**: Site configuration →
   Environment variables →
   - `HA_URL` = your Nabu Casa remote URL (e.g. `https://<instance>.ui.nabu.casa`)
   - `HA_TOKEN` = the token from step 3

5. **Redeploy** (Deploys → Trigger deploy) so the function picks up the
   variables. Open the site URL.

## Sensors read (whitelist)

| Entity | Purpose |
|---|---|
| `sensor.energy_production_today` | Forecast.Solar garage (ESE) |
| `sensor.energy_production_today_2` | Forecast.Solar house (WSW) |
| `sensor.myenergi_my_home_generated_today_2` | Actual generation (cumulative) + intraday history |
| `sensor.solar_calibration_ratio_30d` | 30-day calibration ratio |
| `sensor.solar_hourly_forecast_adjusted` | Cloud-adjusted hourly forecast (+ raw + cloud cover attrs) |
| `sensor.solcast_pv_forecast_forecast_today` | Solcast estimate, 10–90 band, hourly detail |

## Notes

- The site URL is public by default. The proxy is read-only and whitelisted,
  but anyone with the URL can see your generation figures. If that matters,
  enable Netlify password protection or visitor access controls on the site.
- To revoke access entirely at any time, delete the token in HA.
- Data refreshes every 5 minutes in the browser; the function caches for 60s.
