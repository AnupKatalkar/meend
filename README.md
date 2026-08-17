# Meend

*Meend* (मींद) is the continuous glide between two notes in Hindustani music — a
slide rather than a jump. It is the name because every control here is a glide:
pitch through air, filter through wrist tilt, volume through hand height.
Nothing about it steps.

A browser-only musical instrument played with hand gestures in front of a webcam.
Two hands are tracked at ~30 fps: the left hand picks harmony, the right hand
shapes expression.

Nothing leaves the device. There is no server, no API key and no analytics —
camera frames and landmark data are processed in the tab and never uploaded.
The whole thing deploys as static files.

## Why this exists

**Most people have musical ideas but no instrumental technique. This removes
the instrument from between the idea and the sound.**

- **The barrier to making music is technique, not imagination.** Someone can
  hum a progression they like but not play it — years of practice sit between
  the two. Gestures collapse that: hold up three fingers, hear a iii chord. No
  scales to drill, no fingering to learn.
- **No hardware, no install, no account.** Everyone already has a webcam.
  There is no MIDI controller to buy and no DAW to configure. It is a URL.
- **Privacy is what makes it shareable.** Anything asking for camera access is
  asking for trust. This never uploads a frame, and there is no server to
  upload one to — an architectural fact rather than a policy promise. That is
  why skeleton-only recording exists: share a performance without sharing your
  room or your face.
- **It teaches theory by making it physical.** You need not know what "vi"
  means. Make the horns shape, hear it, and the HUD names it while you play.
  Gesture, sound and name are learned in one motion.
- **Not being able to use it is not a dead end.** No camera, poor lighting, or
  hands that cannot hold the shapes — keyboard mode is full parity, not a stub,
  and is offered automatically whenever the camera fails.
- **Musical range beyond the Western default.** Most software treats Indian
  classical as a scale preset. Raga mode models it properly: melodic over a
  drone rather than chordal, separate ascending and descending note-sets, a
  tanpura that retunes for ragas without Pa, and talas where khali is genuinely
  a *lighter* beat. Stacking triads on a raga would misrepresent the tradition.
- **The engineering is the point as much as the toy.** Gesture to sound in
  under 100 ms (measured: ~28 ms), with hysteresis tuned so a held hand
  produces one chord attack rather than a machine-gun of retriggers. That
  difference — between an impressive demo and something playable — is where
  most of the work went.

The success test this was built against: *a stranger opens the URL, grants
camera access, holds up three fingers, and hears a iii chord within two
seconds, with no tutorial.* That test has **not** been run with real users
yet. It is the one that would tell you whether the premise holds.

## Quick start

```bash
npm install     # also vendors the MediaPipe wasm + hand model into public/
npm run dev     # http://localhost:5173
```

`npm install` downloads ~20 MB of tracking assets into `public/`. If it fails
(offline, proxy), the app still installs — run `npm run vendor` once you have
network access.

```bash
npm run build       # typecheck + production bundle into dist/
npm run preview     # serve the built bundle
npm test            # unit tests, no browser or camera needed
npm run test:e2e    # browser suites, needs Chrome (see below)
```

Deploy `dist/` to any static host. **HTTPS is required** — `getUserMedia` will
not run over plain HTTP. `localhost` is exempt during development.

## Playing it

**Left hand — harmony.** Finger count picks the scale degree.

| Gesture | Degree |
|---|---|
| any 1 finger | I |
| any 2 fingers | ii |
| any 3 fingers | iii |
| any 4 fingers | IV |
| all 5 fingers | V |
| index + pinky | vi |
| index + pinky + thumb | vii° |
| closed fist | mute |

**Right hand — expression.** Height is volume, wrist tilt sweeps the filter
(right brighter, left darker), an extended thumb drops an octave, and in Finger
Layout submode the finger count picks triad / 1st inversion / 7th / 9th.

The readout sits in a card above the controls — chord name, a live
oscilloscope of the master bus that moves only when the instrument sounds, and
the key, mode and hand-presence pills. The scope's colour tracks the scale
degree, matching the skeleton, so what you see and what you hear agree.

### Raga mode

Indian classical music is a single melodic line moving against a drone, not a
chord progression, so raga mode is the one mode here that is not chordal. It
plays one note at a time over a tanpura.

| | |
|---|---|
| Left hand | Finger count picks a swara position in the raga |
| Right hand | Height is volume, tilt deepens the oscillation, thumb drops to the lower octave |
| Closed fist | Silence |

Thirteen Hindustani ragas ship with it — Yaman, Bhairav, Bhairavi, Kafi,
Khamaj, Bhupali, Malkauns, Des, Darbari Kanada, Todi, Marwa, Bageshri and
Charukeshi — each with its thaat, vadi/samvadi and traditional time of day.

Two things the model takes seriously rather than flattening:

- **Aroha and avaroha differ.** Many ragas take different notes ascending than
  descending, so the note a gesture produces depends on which way the phrase is
  moving. In Des, the same three-finger gesture is Ma going up and Ga coming
  down. Direction is tracked from the previous position.
- **The tanpura retunes itself.** Its companion string is normally Pa, but
  ragas that omit Pa — Marwa most obviously — get Ma instead, because a drone
  sounding a note the raga excludes fights everything played over it. It is
  four plucked strings cycling (Karplus-Strong), not a sustained pad, because
  the overlap of decaying tails is the sound of the instrument.

Meend — the glide between swaras — is a slider from a fretted jump to a long
portamento. Six talas are available in the metronome (Teental, Jhaptal, Ektal,
Rupak, Keherwa, Dadra) with a tabla-ish voice, and the HUD shows the cycle with
vibhag grouping. Sam, tali and khali are distinct: **khali is rendered lighter,
not louder**, and Rupak's sam is correctly a wave rather than a clap.

What is deliberately *not* modelled: pakad, chalan, and the microtonal
placement of individual shrutis. Those are the difference between "the right
notes" and "the raga", and a finger-count interface cannot carry them — this is
an instrument for exploring a raga's note-set, not a claim to teach one.

### Chord instruments

Three timbres, in Settings → Sound:

| | |
|---|---|
| **Synth** | Detuned triple-saw pad. Sustains for as long as you hold the gesture. |
| **Electric piano** | FM Rhodes. Instant, and genuinely how those instruments made the sound. |
| **Grand piano** | Recorded acoustic piano (Salamander), ~1.8 MB, fetched on first use. |

A synthesized acoustic piano never quite convinces — the attack transient and
the way partials decay at different rates are what the ear listens for — so the
grand is sampled, every minor third across the range, and the Sampler never
pitch-shifts by more than a tone. It is lazy-loaded because most players never
leave the default synth, and it falls back to the synth if the fetch fails.

Both pianos **decay** rather than sustaining, exactly as a real key does: hold a
gesture and the chord rings and fades instead of droning. **Chord blend**
lengthens that ring and adds room; for the synth it also slows the attack and
opens the detune, moving from a crisp stab to a fused pad.

Piano samples are Salamander Grand Piano by Alexander Holm, CC-BY 3.0. The
licence travels with the files in `public/samples/piano/LICENSE.txt`.

**No camera?** Keyboard mode is full parity, not a stub: `1`–`7` for degrees,
`[` / `]` for minor/major, `8 9 0 -` for chord style slots, `Shift` for octave
down, arrows for volume and filter, `Space` to panic. It is offered
automatically whenever camera access fails.

## Architecture

```
src/
  vision/     MediaPipe lifecycle, geometry, gesture classification, filtering
  music/      keys, scales, chord formulas, voice leading, ragas and talas
              (pure, no Tone.js)
  audio/      the Tone.js graph, arpeggiator, bass, metronome
  modes/      gesture / theremin / mono piano / raga / keyboard
  engine/     Conductor — the single rAF loop
  recording/  MediaRecorder orchestration and canvas compositing
  state/      zustand store (settings) + telemetry (per-frame, non-React)
  ui/         React panels and HUD, plus the imperative skeleton renderer
```

**React never owns per-frame data.** Landmarks, skeleton drawing and audio
parameter updates run outside React in one rAF loop owned by
`engine/Conductor.ts`. Discrete, rare events (a chord change, a hand appearing)
go through the zustand store; anything that changes every frame goes through
`state/telemetry.ts`, a mutable singleton read by whoever needs it on its own
schedule. Pushing 30 fps of landmark data through `setState` drops frames.

Two files carry most of the risk and most of the comments:
`vision/smoothing.ts` (One Euro for continuous values, asymmetric hysteresis
for discrete ones) and `vision/fingers.ts` (rotation-invariant finger
extension). They are the difference between an instrument and a demo.

### The handedness mirror trap

The preview is mirrored, but MediaPipe always receives the raw, unmirrored
frames. MediaPipe's docs say handedness is assigned assuming a pre-flipped
selfie image and tell you to swap the output if that is not what you fed it,
so the labels should come out **inverted** relative to the player's anatomy.

Should. Getting this backwards silently reverses every control in the app, and
a documented convention is not a guarantee about one particular camera, so it
is treated as a prior and then measured. `vision/handedness.ts` watches for the
moments both hands are in frame, where a second signal is available that owes
nothing to MediaPipe: in an unmirrored image the player's left hand sits on the
**right** of the picture, as it does in any photograph of someone facing you.
Comparing that against the label on the same hand yields a vote. Twelve
consistent votes, well under a second of two-handed play, commit a polarity and
persist it to `localStorage` under `meend.handedness`.

Consequences worth knowing:

- Crossed arms cannot flip anything. Evidence accumulates and is capped, so a
  settled reading survives a burst of contrary frames but can still be
  overturned in about two seconds of sustained disagreement.
- One-handed play never votes. The prior stands, which is the behaviour that
  shipped before the calibrator existed.
- Replayed landmark clips never vote either. Their labels are authored, not
  observed, so their hand positions carry no physical meaning.

Nothing downstream ever sees a raw `"Left"`/`"Right"` label; every module speaks
in roles (`harmony` / `expression`). The developer panel shows the live reading,
its confidence, and a **Reset handedness** button. Players who want it fixed the
other way, or who are left-handed, still have the **Swap Hands** toggle.

## Testing

- **`npm test`** — 133 unit tests over the pure layers, no camera required.
  `fingers.test.ts` asserts that all eight harmony gestures classify correctly
  across nine rigid transforms (rotated ±45°, near, far, off-centre), which is
  what proves the wrist-distance test is genuinely rotation-invariant.
  `smoothing.test.ts` verifies the retrigger policy under simulated 8% frame
  misreads. `raga.test.ts` and `tala.test.ts` check the data itself — every
  vibhag starts on a marked beat, every tanpura companion is a note the raga
  actually contains, and vadi/samvadi lie inside their raga.
- **`npm run test:e2e`** — drives real Chrome via `puppeteer-core`, using
  Chrome's fake media device so the full pipeline runs with no physical camera.
  Set `CHROME_PATH` if Chrome is not at the macOS default location. Covers
  keyboard mode's chord output, the model + camera boot, all eight gestures
  through the real pipeline, the retrigger policy, measured latency, raga mode
  (including the aroha/avaroha direction switch), tala cycles, recording, and
  console-error hygiene.
- **`node e2e/shots.mjs`** — a manual utility that captures the onboarding,
  loading, idle, playing and settings states to PNGs for visual review.
- **Landmark replay** — the developer panel records raw landmarks to JSON and
  replays them through the whole pipeline with no camera. Iterating threshold
  constants against a live webcam is miserable because you cannot reproduce a
  gesture; this makes tuning repeatable. The e2e gesture suite uses the same
  mechanism with synthetic hands.

Measured on this machine (Chrome, swiftshader, replayed landmarks): **27 ms**
gesture-to-sound latency against the 100 ms budget, ~33 fps, and exactly one
chord attack across a 4-second held gesture.

Still worth doing by hand, since no automated harness covers it: the manual
matrix of Chrome and Firefox on macOS and Windows, in bright and dim rooms,
with a real pair of hands.

## Deviations from the spec

Three, all deliberate.

1. **A ninth chord style, `Diatonic (follows key)`, is the default.** The eight
   specified styles are fixed semitone formulas, so choosing "Major Triad"
   makes *every* scale degree major — the HUD would announce `vi` or `vii°`
   over a plainly major chord, and the spec's own success criterion ("holds up
   three fingers and hears a iii chord") would fail. Diatonic takes the triad
   quality from the key instead. The eight fixed styles are untouched and still
   selectable.
2. **Two files not in the spec's layout**: `engine/Conductor.ts`, which owns the
   single rAF loop and wires the layers together, and `modes/types.ts`, the
   shared mode interface. The spec's file list had no home for either.
3. **Mono Piano triggers on pinch only.** The spec offers a downward flick as an
   alternative and calls it optional; flick needs a velocity estimate that
   frame-to-frame landmark jitter makes unreliable at 30 fps without adding
   exactly the latency a percussive trigger cannot afford.

One spec item was **not** built: Web MIDI output. It appears only in the
"Reader notes (not part of the prompt)" section, so it is outside the brief —
but it is a genuinely good idea and would sit cleanly on top of
`audio/voices.ts`, which already computes note-level attack and release deltas.

## Browser support

Chrome and Edge on desktop are the target. Firefox and Safari work with
degradation — chiefly in recording, where `MediaRecorder`'s MP4 support varies;
the UI probes with `MediaRecorder.isTypeSupported` and states the format you
are actually getting rather than promising MP4. Mobile is best-effort.

If the GPU delegate is unavailable the tracker falls back to CPU and says so.
If tracking drops below 15 fps for a few seconds the app suggests closing other
apps.
