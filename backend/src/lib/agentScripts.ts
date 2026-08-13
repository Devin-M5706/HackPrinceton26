/**
 * Python programs that run inside Dedalus VMs.
 *
 * Each is self-contained, reads its configuration from environment variables,
 * and uses only the Python standard library so no pip install is needed on the
 * guest.
 *
 * Only the surveillance agent remains. Vision, clinical and referral agents
 * used to live here too, but the triage pipeline calls the inference API
 * directly from the orchestrator (see lib/triage.ts) — keeping VM copies of
 * those prompts meant two implementations that drifted apart, and the VM ones
 * were never executed.
 */

// ── Surveillance agent (persistent, never exits) ─────────────────────────────
//
// Environment:
//   SUPABASE_URL, SUPABASE_KEY               read cases, write alerts
//   ORCHESTRATOR_URL                          where to post a fired alert
//   ORCHESTRATOR_INTERNAL_SECRET              shared secret for that call
//
// Notification credentials are deliberately NOT passed to the VM. The agent
// reports a cluster to the orchestrator, which owns the WhatsApp token and
// does the sending — one fewer place for a production secret to sit.

export const SURVEILLANCE_AGENT = String.raw`#!/usr/bin/env python3
"""lumos.health surveillance agent.

Polls the case table on a fixed interval, clusters recent cases by proximity,
and reports clusters that cross the alert threshold to the orchestrator.
Runs until the machine is destroyed.
"""
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone


def env(name, default=None, required=False):
    value = os.environ.get(name, default)
    if required and not value:
        print("[surveillance] FATAL: %s is not set" % name, flush=True)
        sys.exit(1)
    return value


SUPABASE_URL = env("SUPABASE_URL", required=True).rstrip("/")
SUPABASE_KEY = env("SUPABASE_KEY", required=True)
ORCHESTRATOR_URL = env("ORCHESTRATOR_URL", required=True).rstrip("/")
ORCHESTRATOR_SECRET = env("ORCHESTRATOR_INTERNAL_SECRET", required=True)

POLL_INTERVAL_SECONDS = 300
CLUSTER_RADIUS_KM = 10.0
ALERT_THRESHOLD = 3
LOOKBACK_DAYS = 7
# Suppress a repeat alert for the same cluster within this window. Without it
# every poll re-fires the same outbreak and buries the recipient.
ALERT_COOLDOWN_HOURS = 24
HTTP_TIMEOUT_SECONDS = 15
MAX_CONSECUTIVE_FAILURES = 20


def log(message):
    stamp = datetime.now(timezone.utc).isoformat()
    print("[surveillance] %s %s" % (stamp, message), flush=True)


# ── HTTP ─────────────────────────────────────────────────────────────────────

def supabase_get(path, params):
    query = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    request = urllib.request.Request(
        "%s/rest/v1/%s?%s" % (SUPABASE_URL, path, query),
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer %s" % SUPABASE_KEY,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
        return json.loads(response.read())


def supabase_insert(path, row):
    request = urllib.request.Request(
        "%s/rest/v1/%s" % (SUPABASE_URL, path),
        data=json.dumps(row).encode("utf-8"),
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer %s" % SUPABASE_KEY,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
        return response.status


def notify_orchestrator(cluster):
    payload = json.dumps({
        "region": cluster["region"],
        "case_count": cluster["count"],
        "radius_km": CLUSTER_RADIUS_KM,
        "center_lat": cluster["center_lat"],
        "center_lng": cluster["center_lng"],
    }).encode("utf-8")

    request = urllib.request.Request(
        "%s/api/health/notify" % ORCHESTRATOR_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-internal-secret": ORCHESTRATOR_SECRET,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
        log("orchestrator notified, status=%s" % response.status)


# ── Geometry ─────────────────────────────────────────────────────────────────

def haversine_km(lat1, lng1, lat2, lng2):
    radius = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lng / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def find_clusters(cases):
    """Single-link clustering: cases within CLUSTER_RADIUS_KM of each other,
    transitively, form one cluster. Every case lands in exactly one cluster,
    and the result does not depend on the order rows came back from the
    database."""
    unvisited = set(range(len(cases)))
    clusters = []

    while unvisited:
        seed = unvisited.pop()
        members = [seed]
        frontier = [seed]

        while frontier:
            current = frontier.pop()
            neighbours = [
                index
                for index in unvisited
                if haversine_km(
                    cases[current]["lat"], cases[current]["lng"],
                    cases[index]["lat"], cases[index]["lng"],
                ) <= CLUSTER_RADIUS_KM
            ]
            for index in neighbours:
                unvisited.discard(index)
                members.append(index)
                frontier.append(index)

        if len(members) < ALERT_THRESHOLD:
            continue

        rows = [cases[i] for i in members]
        clusters.append({
            "count": len(rows),
            "center_lat": sum(r["lat"] for r in rows) / len(rows),
            "center_lng": sum(r["lng"] for r in rows) / len(rows),
            "region": rows[0].get("region") or "unknown",
        })

    return clusters


# ── Alert handling ───────────────────────────────────────────────────────────

def recently_alerted(cluster):
    """True if an alert for roughly this cluster already fired recently."""
    since = (
        datetime.now(timezone.utc) - timedelta(hours=ALERT_COOLDOWN_HOURS)
    ).isoformat()

    try:
        recent = supabase_get("alerts", {
            "select": "center_lat,center_lng,region",
            "fired_at": "gte.%s" % since,
        })
    except Exception as error:
        # Fail open: an alert delivered twice beats an outbreak going unreported.
        log("cooldown check failed (%s) - alerting anyway" % error)
        return False

    for row in recent:
        if row.get("region") != cluster["region"]:
            continue
        distance = haversine_km(
            row["center_lat"], row["center_lng"],
            cluster["center_lat"], cluster["center_lng"],
        )
        if distance <= CLUSTER_RADIUS_KM:
            return True

    return False


def record_alert(cluster, notified):
    supabase_insert("alerts", {
        "region": cluster["region"],
        "case_count": cluster["count"],
        "radius_km": int(CLUSTER_RADIUS_KM),
        "center_lat": cluster["center_lat"],
        "center_lng": cluster["center_lng"],
        "fired_at": datetime.now(timezone.utc).isoformat(),
        "notified": notified,
    })


def handle_cluster(cluster):
    if recently_alerted(cluster):
        log("cluster in %s already alerted within %sh - skipping"
            % (cluster["region"], ALERT_COOLDOWN_HOURS))
        return

    log("CLUSTER: %s cases in %s" % (cluster["count"], cluster["region"]))

    notified = False
    try:
        notify_orchestrator(cluster)
        notified = True
    except Exception as error:
        log("orchestrator notification failed: %s" % error)

    # Record the alert either way so it appears in the dashboard even when
    # delivery failed, and so the cooldown applies.
    try:
        record_alert(cluster, notified)
    except Exception as error:
        log("could not persist alert: %s" % error)


# ── Poll loop ────────────────────────────────────────────────────────────────

def poll():
    since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()

    cases = supabase_get("cases", {
        "select": "id,lat,lng,region",
        "created_at": "gte.%s" % since,
        "stage": "gte.2",
    })

    usable = [
        c for c in cases
        if isinstance(c.get("lat"), (int, float))
        and isinstance(c.get("lng"), (int, float))
        and (c["lat"] != 0 or c["lng"] != 0)
    ]

    log("%s cases in last %sd (%s geolocated)"
        % (len(cases), LOOKBACK_DAYS, len(usable)))

    if len(usable) < ALERT_THRESHOLD:
        return

    for cluster in find_clusters(usable):
        handle_cluster(cluster)


def main():
    log("agent started, polling every %ss" % POLL_INTERVAL_SECONDS)
    failures = 0

    while True:
        try:
            poll()
            failures = 0
        except Exception as error:
            failures += 1
            log("poll failed (%s consecutive): %s" % (failures, error))
            if failures >= MAX_CONSECUTIVE_FAILURES:
                log("giving up after %s consecutive failures" % failures)
                sys.exit(1)

        # Back off on repeated failure so a broken dependency is not hammered.
        delay = POLL_INTERVAL_SECONDS * min(2 ** failures, 8) if failures else POLL_INTERVAL_SECONDS
        time.sleep(delay)


if __name__ == "__main__":
    main()
`;
