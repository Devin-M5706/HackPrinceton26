/**
 * Agent scripts that run inside Dedalus VMs.
 *
 * Each is a self-contained Python 3 program that reads config from environment
 * variables, does its job (usually one Kimi API call), and writes a JSON result
 * to stdout.  The orchestrator base64-encodes the script, echoes it onto the
 * VM, and executes it with `python3 /tmp/agent.py`.
 *
 * No third-party pip packages are required — all networking uses urllib from
 * the standard library.
 */

// ── VM 1 — Vision agent ───────────────────────────────────────────────────────
// Inputs (env):  IMAGE_B64, DEDALUS_API_KEY
// Output (stdout): JSON { stage, risk_score, confidence, findings, urgent }

export const VISION_AGENT = `
#!/usr/bin/env python3
import json, os, sys, urllib.request, urllib.error

image_b64  = os.environ.get('IMAGE_B64', '')
api_key    = os.environ.get('DEDALUS_API_KEY', '')

PROMPT = """You are an expert clinician trained in WHO Noma (cancrum oris) staging.
Examine the wound in this image and return ONLY a valid JSON object — no markdown, no prose.

Fields required:
- stage: integer 1–5 (WHO Noma stage; 1=prodromal, 5=healed/sequela)
- risk_score: integer 0–100 (0=no risk, 100=life-threatening)
- confidence: float 0.0–1.0
- findings: array of short strings describing key visual observations
- urgent: boolean (true if immediate hospital referral is needed)"""

payload = json.dumps({
    "model": "anthropic/claude-haiku-4-5-20251001",
    "messages": [
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}
                },
                {"type": "text", "text": PROMPT}
            ]
        }
    ],
    "max_tokens": 512
}).encode()

req = urllib.request.Request(
    'https://api.dedaluslabs.ai/v1/chat/completions',
    data=payload,
    headers={
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
)

try:
    with urllib.request.urlopen(req, timeout=40) as resp:
        body = json.loads(resp.read())
        content = body['choices'][0]['message']['content'].strip()
        start = content.find('{')
        end   = content.rfind('}') + 1
        result = json.loads(content[start:end])
        print(json.dumps(result))
except Exception as e:
    fallback = {
        "stage": 0,
        "risk_score": 0,
        "confidence": 0.0,
        "findings": [],
        "urgent": False,
        "error": str(e)
    }
    print(json.dumps(fallback))
    sys.exit(0)
`;

// ── VM 2 — Clinical reasoning agent ──────────────────────────────────────────
// Inputs (env):  VISION_JSON (JSON string from VM 1), CHILD_META_JSON, DEDALUS_API_KEY
// Output (stdout): JSON { who_stage_confirmed, clinical_note, recommendation, triage }

export const CLINICAL_AGENT = `
#!/usr/bin/env python3
import json, os, sys, urllib.request

vision_data = json.loads(os.environ.get('VISION_JSON', '{}'))
child_meta  = json.loads(os.environ.get('CHILD_META_JSON', '{}'))
api_key     = os.environ.get('DEDALUS_API_KEY', '')

user_message = f"""Vision analysis result:
{json.dumps(vision_data, indent=2)}

Child metadata:
- Age: {child_meta.get('age_months', 'unknown')} months
- Sex: {child_meta.get('sex', 'unknown')}
- Presenting symptoms: {child_meta.get('symptoms', 'not recorded')}
- Nutritional status: {child_meta.get('nutrition_status', 'not recorded')}

Using WHO Noma staging criteria, provide a full clinical reasoning note.
Return ONLY a valid JSON object with these fields:
- who_stage_confirmed: integer 1–5
- clinical_note: string (detailed clinical reasoning, 3–6 sentences)
- recommendation: string (immediate action for the CHW)
- triage: one of "urgent" | "refer" | "monitor" | "healthy"
- risk_factors: array of strings"""

payload = json.dumps({
    "model": "anthropic/claude-haiku-4-5-20251001",
    "messages": [
        {
            "role": "system",
            "content": "You are a WHO-trained Noma specialist providing clinical decision support for community health workers in sub-Saharan Africa. Always err on the side of caution — a missed Noma case can be fatal within days."
        },
        {"role": "user", "content": user_message}
    ],
    "max_tokens": 1024
}).encode()

req = urllib.request.Request(
    'https://api.dedaluslabs.ai/v1/chat/completions',
    data=payload,
    headers={
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
)

try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read())
        content = body['choices'][0]['message']['content'].strip()
        start = content.find('{')
        end   = content.rfind('}') + 1
        result = json.loads(content[start:end])
        print(json.dumps(result))
except Exception as e:
    fallback = {
        "who_stage_confirmed": vision_data.get('stage', 0),
        "clinical_note": f"Clinical reasoning unavailable: {str(e)}",
        "recommendation": "Refer to nearest health facility immediately.",
        "triage": "refer",
        "risk_factors": [],
        "error": str(e)
    }
    print(json.dumps(fallback))
    sys.exit(0)
`;

// ── VM 3 — Referral agent ─────────────────────────────────────────────────────
// Inputs (env):  CLINICAL_JSON, CHW_REGION, CHW_LANGUAGE, CHW_LAT, CHW_LNG,
//                DEDALUS_API_KEY, SUPABASE_URL, SUPABASE_KEY
// Output (stdout): JSON { clinic_id, clinic_name, distance_km, contact, referral_note }

export const REFERRAL_AGENT = `
#!/usr/bin/env python3
import json, os, sys, math, urllib.request, urllib.parse

clinical   = json.loads(os.environ.get('CLINICAL_JSON', '{}'))
region     = os.environ.get('CHW_REGION', '')
language   = os.environ.get('CHW_LANGUAGE', 'english')
chw_lat    = float(os.environ.get('CHW_LAT', '0'))
chw_lng    = float(os.environ.get('CHW_LNG', '0'))
api_key    = os.environ.get('DEDALUS_API_KEY', '')
supa_url   = os.environ.get('SUPABASE_URL', '')
supa_key   = os.environ.get('SUPABASE_KEY', '')

def haversine(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

# Query Supabase for nearest noma-capable clinic
try:
    query = f"{supa_url}/rest/v1/clinics?noma_capable=eq.true&select=*"
    req = urllib.request.Request(
        query,
        headers={
            'apikey': supa_key,
            'Authorization': f'Bearer {supa_key}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        clinics = json.loads(resp.read())
except Exception as e:
    clinics = []

nearest = None
nearest_dist = float('inf')
for c in clinics:
    dist = haversine(chw_lat, chw_lng, c['lat'], c['lng'])
    if dist < nearest_dist:
        nearest_dist = dist
        nearest = c

if not nearest:
    nearest = {'id': None, 'name': 'Nearest Health Centre', 'contact': 'N/A', 'lat': chw_lat, 'lng': chw_lng}
    nearest_dist = 0

# Generate referral note in CHW language
lang_prompt = {
    'hausa': 'Write the referral note in Hausa language.',
    'french': 'Rédigez la note de référence en français.',
    'english': 'Write the referral note in English.'
}.get(language, 'Write the referral note in English.')

note_prompt = f"""Generate a brief referral note for a community health worker to give to a clinic.

Clinical context:
{json.dumps(clinical, indent=2)}

Nearest facility: {nearest.get('name', 'Health Centre')} ({nearest_dist:.1f} km away)

{lang_prompt}

Return ONLY a valid JSON object with one field:
- referral_note: string (the complete referral note, 3–5 sentences, plain text not markdown)"""

payload = json.dumps({
    "model": "anthropic/claude-haiku-4-5-20251001",
    "messages": [{"role": "user", "content": note_prompt}],
    "max_tokens": 512
}).encode()

req2 = urllib.request.Request(
    'https://api.dedaluslabs.ai/v1/chat/completions',
    data=payload,
    headers={
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
)

referral_note = "Please refer this patient immediately to the nearest Noma-capable facility."
try:
    with urllib.request.urlopen(req2, timeout=30) as resp:
        body = json.loads(resp.read())
        content = body['choices'][0]['message']['content'].strip()
        start = content.find('{')
        end   = content.rfind('}') + 1
        note_obj = json.loads(content[start:end])
        referral_note = note_obj.get('referral_note', referral_note)
except Exception:
    pass

result = {
    "clinic_id": nearest.get('id'),
    "clinic_name": nearest.get('name', 'Health Centre'),
    "distance_km": round(nearest_dist, 1),
    "contact": nearest.get('contact', 'N/A'),
    "referral_note": referral_note
}
print(json.dumps(result))
`;

// ── VM 4 — Surveillance agent (persistent, never exits) ───────────────────────
// Inputs (env):  SUPABASE_URL, SUPABASE_KEY, TWILIO_WEBHOOK_URL,
//                TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//                TWILIO_FROM_NUMBER, TWILIO_ALERT_TO_NUMBER
// Behaviour: infinite loop, polls every 5 min, inserts alerts + fires SMS

export const SURVEILLANCE_AGENT = `
#!/usr/bin/env python3
"""VM 4 — NomaAlert Surveillance Agent
Runs forever. Polls Supabase every 5 minutes.
Buckets positive cases by 10km radius; fires SMS + inserts alert if 3+ cases found.
"""
import json, os, math, time, urllib.request, urllib.parse, base64
from datetime import datetime, timezone, timedelta

SUPABASE_URL  = os.environ['SUPABASE_URL']
SUPABASE_KEY  = os.environ['SUPABASE_KEY']
WA_PHONE_ID      = os.environ.get('WHATSAPP_PHONE_NUMBER_ID', '')
WA_TOKEN         = os.environ.get('WHATSAPP_ACCESS_TOKEN', '')
WA_TO            = os.environ.get('WHATSAPP_ALERT_TO_NUMBER', '')
ORCHESTRATOR_URL    = os.environ.get('ORCHESTRATOR_URL', '')
ORCHESTRATOR_SECRET = os.environ.get('ORCHESTRATOR_INTERNAL_SECRET', '')

POLL_INTERVAL = 300   # seconds (5 minutes)
CLUSTER_RADIUS_KM = 10
ALERT_THRESHOLD = 3
LOOKBACK_DAYS = 7

def supa_get(path):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def supa_post(path, data):
    payload = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        data=payload,
        headers={
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        }
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status

def haversine(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def find_clusters(cases):
    """Greedy clustering: for each unvisited case, count neighbours within radius."""
    clusters = []
    visited = set()
    for i, c in enumerate(cases):
        if i in visited:
            continue
        members = [c]
        for j, other in enumerate(cases):
            if j != i and j not in visited:
                if haversine(c['lat'], c['lng'], other['lat'], other['lng']) <= CLUSTER_RADIUS_KM:
                    members.append(other)
                    visited.add(j)
        visited.add(i)
        if len(members) >= ALERT_THRESHOLD:
            center_lat = sum(m['lat'] for m in members) / len(members)
            center_lng = sum(m['lng'] for m in members) / len(members)
            clusters.append({
                'count': len(members),
                'center_lat': center_lat,
                'center_lng': center_lng,
                'region': members[0].get('region', 'unknown'),
                'cases': members
            })
    return clusters

def build_alert_msg(cluster):
    return (
        f"NOMA ALERT: {cluster['count']} cases within {CLUSTER_RADIUS_KM}km "
        f"in {cluster['region']}. "
        f"Center: {cluster['center_lat']:.4f},{cluster['center_lng']:.4f}. "
        f"Immediate public health response required."
    )

def fire_whatsapp(cluster):
    """Send outbreak alert via Meta WhatsApp Cloud API (proactive outbound)."""
    if not WA_PHONE_ID or not WA_TOKEN or not WA_TO:
        print(f"[surveillance] WhatsApp not configured — would alert: {cluster['count']} cases in {cluster['region']}")
        return
    payload = json.dumps({
        "messaging_product": "whatsapp",
        "to": WA_TO,
        "type": "text",
        "text": {"body": build_alert_msg(cluster), "preview_url": False}
    }).encode()
    req = urllib.request.Request(
        f"https://graph.facebook.com/v21.0/{WA_PHONE_ID}/messages",
        data=payload,
        headers={
            'Authorization': f'Bearer {WA_TOKEN}',
            'Content-Type': 'application/json'
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            print(f"[surveillance] WhatsApp alert sent, status={r.status}")
    except Exception as e:
        print(f"[surveillance] WhatsApp alert failed: {e}")

def fire_imessage(cluster):
    """Dispatch iMessage alert via orchestrator /api/health/notify (Photon Spectrum)."""
    if not ORCHESTRATOR_URL:
        print("[surveillance] ORCHESTRATOR_URL not set — skipping iMessage dispatch")
        return
    payload = json.dumps({
        "region": cluster['region'],
        "case_count": cluster['count'],
        "radius_km": CLUSTER_RADIUS_KM,
        "center_lat": cluster['center_lat'],
        "center_lng": cluster['center_lng'],
    }).encode()
    req = urllib.request.Request(
        f"{ORCHESTRATOR_URL}/api/health/notify",
        data=payload,
        headers={
            'Content-Type': 'application/json',
            'x-internal-secret': ORCHESTRATOR_SECRET
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            print(f"[surveillance] iMessage dispatch triggered, status={r.status}")
    except Exception as e:
        print(f"[surveillance] iMessage dispatch failed: {e}")

def record_alert(cluster):
    supa_post('alerts', {
        'region': cluster['region'],
        'case_count': cluster['count'],
        'radius_km': CLUSTER_RADIUS_KM,
        'center_lat': cluster['center_lat'],
        'center_lng': cluster['center_lng'],
        'fired_at': datetime.now(timezone.utc).isoformat(),
        'notified': bool(WA_TOKEN or ORCHESTRATOR_URL)
    })

def poll():
    since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    try:
        cases = supa_get(f"cases?created_at=gte.{since}&stage=gte.2&select=id,lat,lng,region")
    except Exception as e:
        print(f"[surveillance] DB error: {e}")
        return

    print(f"[surveillance] {datetime.now(timezone.utc).isoformat()} — {len(cases)} positive cases in last {LOOKBACK_DAYS}d")

    if len(cases) < ALERT_THRESHOLD:
        return

    clusters = find_clusters(cases)
    for cluster in clusters:
        print(f"[surveillance] CLUSTER DETECTED: {cluster['count']} cases in {cluster['region']}")
        record_alert(cluster)
        fire_whatsapp(cluster)
        fire_imessage(cluster)

    # Persist last-run timestamp to /home/machine for health checks
    try:
        with open('/home/machine/last_poll.txt', 'w') as f:
            f.write(datetime.now(timezone.utc).isoformat())
    except Exception:
        pass

print("[surveillance] Agent started. Polling every 5 minutes.")
while True:
    try:
        poll()
    except Exception as e:
        print(f"[surveillance] Unhandled error in poll loop: {e}")
    time.sleep(POLL_INTERVAL)
`;
