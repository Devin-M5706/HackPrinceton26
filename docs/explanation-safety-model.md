# Why the app fails towards "refer"

lumos.health puts a language model between a sick child and a health worker who
may be hours from the nearest clinician. That position sets the design
constraints. This document explains the choices that are not obvious from
reading the code, and what each one costs.

## The problem: a confident wrong answer is worse than no answer

A community health worker photographs a child's mouth and gets a screen back.
Whatever that screen says will be weighed against their own judgement. If the
tool says "healthy" with a plausible-looking clinical note, it has spent its
credibility arguing against referral — for a disease where untreated progression
from stage 1 to stage 3 takes days and mortality without treatment is commonly
cited at around 90%.

So the failure that matters is not "the tool errored". It is "the tool produced
something that reads like a diagnosis and was wrong".

An earlier revision of `triage.ts` did exactly that. When a model call failed it
fell back to canned data:

```
Stage 3, necrosis on the left cheek, risk score 72
```

Those were real-looking findings for a child nobody had assessed. The fallback
existed to keep the UI from breaking, and it turned every outage into a
fabricated diagnosis.

## The approach: an empty result, flagged, defaulting to refer

A failed stage now returns an explicitly empty result. No stage, no score, no
findings.

```ts
const UNASSESSED_VISION = Object.freeze({
  stage: 0, risk_score: 0, confidence: 0, findings: [], urgent: false,
});
```

Three things follow:

1. The packet is flagged `degraded: true`, with `degraded_stages` naming what
   failed.
2. Triage defaults to `refer`. Send the child to a clinician, because the tool
   could not assess them.
3. The UI says the assessment was incomplete, rather than rendering an empty
   result as a clean bill of health.

**Stage 2 is skipped entirely when stage 1 fails.** Clinical reasoning over an
empty vision result would only invite the model to invent findings — it has a
prompt asking for a clinical note and nothing to base one on. Skipping is the
point; both stages get marked degraded.

The pipeline never rejects on a model or database failure. A health worker
standing in front of a sick child gets a conservative result, not an error
screen.

See the diagram in the [root README](../README.md#the-triage-pipeline).

### Trade-offs

- **False referrals cost real money and time.** A caregiver may travel hours to
  a facility they did not need. We accept that, because the alternative error
  sends a child with active necrosis home.
- **Degraded results are less useful than an error would be to a developer.** A
  200 response with `degraded: true` is easy to ignore if a client forgets to
  check the flag. The mitigation is that triage is already `refer`, so ignoring
  the flag still fails safe.
- **Mock mode has to be loud.** Demo output is labelled in the packet
  (`mock: true`) and in the text of every field, and a test asserts it, because
  canned data that looks real is the exact failure this design exists to
  prevent.

## Model output is untrusted input

Model output is parsed with a Zod schema through `parseModelJson`, which returns
`null` rather than throwing. Every caller has a clinically safe fallback.

The reason for `null` over an exception is that a partially-parsed medical
result is worse than none. A response missing `triage` but carrying a confident
`clinical_note` would otherwise flow onward with a default triage level attached
to real-sounding prose.

Nothing reaches the database or a clinician's screen without passing a schema.

## The public map is de-identified server-side

`GET /api/cases/map` needs no authentication, because an outbreak map is only
useful if health authorities and the public can see it. That makes every field
it returns a disclosure decision.

Coordinates are rounded to two decimal places, roughly 1.1 km at the equator:

```ts
export function coarsenCoordinate(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
```

Enough to show a cluster. Not enough to identify the household a sick child
lives in. The endpoint also omits age, reporting worker and clinical notes, and
a test asserts the rounding "discards precision that could identify a
household".

Rounding happens on the server. Doing it in the browser would mean the precise
coordinates had already been sent.

**Trade-off:** two clusters within ~1 km of each other are indistinguishable on
the public map. Authenticated users with a legitimate scope see real
coordinates.

## Access control is application code, not the database

The backend uses the Supabase service-role key, which bypasses row-level
security. Every access rule therefore lives in application code, mostly
`backend/src/routes/cases.ts`.

This is a real risk and worth naming: a missed check is not caught by a second
layer. It is why `resolveCaseScope` is a pure function with its own test suite,
and why an empty `region` is refused rather than treated as absent — treating
`region=''` as "no filter" would have widened a supervisor's scope to every
region in one character.

## Tokens are stored hashed, roles are explicit

Only a SHA-256 digest of a bearer token is persisted, so a dump of the `chws`
table yields no usable credentials. `tests/auth.test.ts` cross-checks the
application's digest against the one Postgres produces for the seeded tokens: if
those ever disagree, every seeded login breaks at once.

Access is decided by an explicit `role` column. It previously came from pattern
matching on a free-text region field, which meant a CHW whose region string
happened to match a supervisor pattern was handed supervisor scope.

Migration `003_token_hashing_and_roles.sql` introduces both and backfills
existing rows.

## Alerting fails open

The surveillance agent skips a cluster it has already alerted on within 24
hours, so one outbreak does not page the same number every five minutes.

If the cooldown check itself fails, the alert is sent anyway:

```python
except Exception as error:
    # Fail open: an alert delivered twice beats an outbreak going unreported.
    log("cooldown check failed (%s) - alerting anyway" % error)
    return False
```

This is the opposite default from the triage pipeline, and deliberately so. In
triage, uncertainty means do less and refer to a human. In alerting, uncertainty
means do more, because the cost is a duplicate WhatsApp message.

## The 3D viewer is schematic, and says so

`viewer.html` renders a generic anatomical model shaded by WHO stage. It is not
the patient's anatomy and not a reconstruction of their photograph. The page
states this, because a realistic-looking 3D lesion reads as medical imaging to
anyone who is not told otherwise, and imaging implies a level of assessment that
did not happen.

## Related

- [Testing reference](reference-testing.md) — the regressions guarding these rules
- [Frontend reference](reference-frontend.md)
- `backend/src/lib/triage.ts` — the pipeline and its safety contract
