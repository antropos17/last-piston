# Last Piston / Engine Lab 0.14

An interactive engine cutaway and two-pedal test stand. The last piston keeps going.

## Open

Open the supplied portable HTML, or build it locally:

```sh
cd engine-lab
npm run assets:verify
npm test
npm run build
```

`dist/last-piston.html` includes all source, styles, eight vector assets and six actual CC0 sound recordings. No runtime packages, network connection, API keys, backend or tracking are needed. A static server can serve `index.html` for source development.

## Controls

Click the ignition key to start or stop the engine. Hold the right pedal for gas and the left pedal for brake. Drag higher for more travel. Two fingers operate independently. W / Arrow Up / Space applies gas. S / Arrow Down / B applies brake. Release resets that input. Key-off stops the engine without repairing it. M toggles sound. R twice within four seconds resets the whole engine.

Cylinder cards zoom into a bore. The part row inspects the radiator, pump, filter, exhaust or crankcase. General view returns to the full stand. The four section/oil/thermal/wear layers and inspection pause are available. Audio mix sliders are in **Звук и лицензии**. Rendering quality, reduced shake, normal/stress profiles and battery boost are in settings.

## 0.13 improvements

0.13.1 adds load-sensitive recorded audio, visible compression-ring wear, separate thermostat flow indicators, exhaust pulses and contact-driven fragment jams. The portable build retains the six original WAVs and reads version 7 saves.

The previously network-dependent soundbank is now real and offline. Six unmodified originals are checked against their SHA-256 manifest. The player downmixes and removes DC, normalizes with a peak cap, crossfades proper loop boundaries and caps transient voices. Repeated gestures do not create duplicate loops; starter audio ends when combustion begins. Engine and mechanical recordings have separate mix controls.

Eight authored SVG assets add radiator louvers, shaped fan blades, filter media and bypass, pump casing/impeller, thermostat, muffler packing/baffles and flange hardware. They are embedded and raster-cached once; fluid windows and moving elements follow live simulation values. Five part inspection views remain live in all diagnostic layers.

Internal-fragment geometry workspaces are reused rather than recreated every substep. A stationary trapped piece no longer ages toward release. Smoke, external debris, internal bodies, audio voices and caches remain bounded.

## Model scope

A 2D mechanical sandbox, not certified engine analysis. Internal pieces have contacts and jams; flow is a reduced network model, not CFD. A deliberate low-speed assist keeps the last cylinder running. The sound recordings are generic, not a calibrated acoustic model of a particular engine. Cooling, stopping and reloading never repair damage. No automatic game-over or restart exists.

## Source and verification

`src/internals.js` owns contact/debris/fluid state, `src/asset-renderer.js` the cached vector presentation, `src/audio-utils.js` PCM preparation, and `src/sample-audio.js` recorded playback. Previous model, dashboard, ignition and pedal modules remain in place. `tools/make-svg-assets.py` rebuilds SVG sources; `tools/fetch-audio.cjs` reuses verified audio or fetches missing files without destroying a complete bank.

Run `python tools/check_assets.py` with Playwright and Chromium to check the portable HTML with the network blocked. The suite decodes the embedded WAVs and writes screenshots and a report to a versioned folder under `dist/`. See RELEASE-13.md and SOURCES.md for the 0.13.0 baseline and original asset credits.

## Repository boundary

Project folder: `engine-lab/`, branch `engine-lab`, repository `antropos17/build_demo1`. Do not modify the parent application's main branch. Standalone builds are produced locally and shared separately.
