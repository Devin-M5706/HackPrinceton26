# Tutorial: run your first screening

By the end of this you will have the API and the web app running on your own
machine, and you will have pushed a photo through the triage pipeline and seen a
result render in the 3D viewer.

Nothing here needs a database, a model provider, or a cloud account. You will
run in **mock mode**, where the pipeline returns a clearly-labelled
demonstration result instead of calling a model.

> The demo result is fabricated. It is labelled as such in every field, on
> purpose. See [why](explanation-safety-model.md).

## What you'll need

- Node.js 20 or newer (`node --version`)
- Two terminal windows
- Any photo file (JPEG, PNG or WebP, under 8 MB). A picture of anything will do
  — mock mode never looks at it.

## Step 1: Start the API

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

`MOCK_MODE=true` is already the default in `.env.example`, so there is nothing
to edit.

You should see the server come up on port 3001. Confirm it in your other
terminal:

```bash
curl http://localhost:3001/api/health
```

```json
{ "status": "ok", "mock_mode": true, ... }
```

That `"mock_mode": true` is what unlocks the demo login in the next step.

## Step 2: Start the web app

In the second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. You should see the landing page with a case map.

You did not configure an API URL, and you do not need to: `npm run dev` proxies
`/api` to `localhost:3001`.

## Step 3: Sign in

Click **Sign in**, then **Continue with the demo account**.

You are now signed in as a demo CHW. A bearer token is in `localStorage` under
`lumos_token`.

The demo button only appears because the server reported `mock_mode: true`. A
server running for real rejects the `demo` token outright, so this shortcut
cannot follow you into production.

## Step 4: Submit a screening

In the screening panel:

1. Enter the child's age and sex. Anything within range works.
2. Choose your photo.
3. Submit.

The browser asks for your location. Allow or deny — denying just means no clinic
distance is calculated.

After a moment the page navigates to the 3D viewer with a result:

- **Triage:** urgent
- **WHO stage:** 3
- **Risk score:** 72
- A clinical note and a referral note, both beginning "Demonstration result."

The model on screen is a generic anatomical illustration shaded by stage. It is
not your photo and not the patient's anatomy.

## Step 5: See the case on the map

Go back to http://localhost:5173 and look at the map, or open
http://localhost:5173/map.html for the full-screen version.

In mock mode without Supabase configured the case is not persisted, so the map
shows only the historical sites from published literature — the purple circles,
sized by total case count for each site over a study period.

Check the API response field `persisted` to see whether a case was written. With
Supabase configured it would be `true` and your point would appear on the map,
rounded to a ~1.1 km grid.

## What you built

You have the full stack running locally: the Express orchestrator in mock mode
and the Vite multi-page app talking to it through a dev proxy. You pushed an
image through `POST /api/screen` and rendered the resulting triage packet.

What you have *not* seen is real inference. Every clinical value on that screen
was canned.

Next steps:

- **Run it for real.** Fill in `backend/.env` and set `MOCK_MODE=false`. The
  variable table is in the [root README](../README.md#running-against-real-services).
- **Understand the failure behaviour.** [Why the app fails towards "refer"](explanation-safety-model.md)
  is the most important document in this repo.
- **Look around the frontend.** [Frontend reference](reference-frontend.md).
- **Run the tests.** [How to run the tests](howto-run-tests.md).

## Troubleshooting

**The demo sign-in button is missing.** The server is not in mock mode. Check
`MOCK_MODE=true` in `backend/.env` and restart it, then reload the page.

**`ECONNREFUSED` in the browser console.** The backend is not running, or not on
port 3001. The Vite proxy targets `http://localhost:3001` specifically.

**The upload is rejected before it is sent.** The file is over 8 MB or is not
JPEG, PNG or WebP. The frontend mirrors the backend limits to avoid a wasted
upload.

**Config validation failed at boot.** The backend refuses to start on a bad
`.env` rather than surfacing `undefined` deep inside a request. Read the
message; it names the variable.
