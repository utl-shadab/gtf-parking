"use client";

import { useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import type { Action, CameraMode, Gear, Level } from "@/types/game";
import { activeBay, advanceDrive, createDriveState } from "@/lib/utils/driving";
import type { DriveState } from "@/lib/utils/driving";
import { DriveControls } from "@/components/ui/drive-controls";
import { GameEntry } from "@/components/ui/game-entry";
import { GameHelp } from "@/components/ui/game-help";
import { Icon } from "@/components/ui/icon";
import { Garage } from "./garage";
import { ParkingAudio } from "@/lib/utils/parking-audio";
import { createEndlessTrial } from "@/lib/utils/endless-trials";
import { defaultGarage, garageKey, readGarage } from "@/lib/utils/garage";
import type { GarageState, VehicleSelection } from "@/types/vehicle";

const cameras: CameraMode[] = ["Overview", "Chase", "Overhead", "Cabin"];
const step = 1 / 120;
const progressKey = "parkline-ratings-v1";
const endlessProgressKey = "parkline-endless-v1";
const audioKey = "parkline-sound";
const movementKeys = new Set(["KeyW", "KeyS", "KeyA", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);
type Overlay = "levels" | "pause" | "parked" | "failed" | null;
const impactNames = { wall: "Wall", car: "Parked car", barrier: "Barrier" } as const;

function difficulty(index: number) {
  if (index < 2) return "Beginner";
  if (index < 5) return "Intermediate";
  if (index < 8) return "Advanced";
  if (index >= 49) return "Master";
  if (index >= 19) return "Extreme";
  return "Expert";
}

function readRatings(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(progressKey) ?? "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => (
      typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] >= 1 && entry[1] <= 3
    )));
  } catch {
    return {};
  }
}

function readEndlessProgress() {
  try {
    const value = Number(localStorage.getItem(endlessProgressKey));
    return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER - 100 ? value : 0;
  } catch { return 0; }
}

function formatTime(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function ParkingGame({ levels }: { levels: Level[] }) {
  const [{ index: levelIndex, level }, setTrial] = useState(() => ({ index: 0, level: levels[0] }));
  const [trialPage, setTrialPage] = useState(0);
  const [gear, setGear] = useState<Gear>("D");
  const [camera, setCamera] = useState<CameraMode>("Overview");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundReady, setSoundReady] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>("levels");
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [revision, setRevision] = useState(0);
  const [controlLayout, setControlLayout] = useState(0);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [endlessCleared, setEndlessCleared] = useState(0);
  const [garage, setGarage] = useState(defaultGarage);
  const garageRef = useRef(garage);
  const [vehicle, setVehicle] = useState<VehicleSelection>(defaultGarage.cars.thar);
  const ratingsRef = useRef(ratings);
  const endlessProgress = useRef(0);
  const upcomingTrial = useRef<{ index: number; level: Level } | null>(null);
  const introUnlocked = levels.findLastIndex((trial) => Boolean(ratings[trial.id])) + 1;
  const lastUnlocked = introUnlocked === levels.length ? levels.length + endlessCleared : introUnlocked;
  const cleared = levels.filter((trial) => Boolean(ratings[trial.id])).length + endlessCleared;
  const pageStart = trialPage * levels.length;
  const lastPage = Math.floor(lastUnlocked / levels.length);
  const [view, setView] = useState(() => createDriveState(level.start));
  const gameRoot = useRef<HTMLElement>(null);
  const entryTitle = useRef<HTMLHeadingElement>(null);
  const playfield = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const helpDialog = useRef<HTMLDialogElement>(null);
  const drive = useRef<DriveState>(view);
  const cameraRef = useRef<CameraMode>("Overview");
  const previousView = useRef<Exclude<CameraMode, "Rear">>("Overview");
  const gearRef = useRef<Gear>("D");
  const overlayRef = useRef<Overlay>("levels");
  const running = useRef(false);
  const audio = useRef<ParkingAudio | null>(null);
  const control = useRef({ keys: new Set<string>(), buttons: new Set<Action>(), wheel: null as number | null });
  const hadInput = useRef(false);

  function clearInputs() {
    control.current.keys.clear();
    control.current.buttons.clear();
    control.current.wheel = null;
  }

  function showOverlay(next: Overlay) {
    clearInputs();
    if (next) audio.current?.suspend();
    if (next === "levels") setTrialPage(Math.floor(levelIndex / levels.length));
    overlayRef.current = next;
    setOverlay(next);
  }

  function chooseGear(next: Gear) {
    if (gearRef.current !== next) {
      audio.current?.unlock();
      audio.current?.cue("shift");
    }
    gearRef.current = next;
    setGear(next);
  }

  function chooseNextCamera() {
    const next = cameraRef.current === "Rear" ? previousView.current
      : cameras[(cameras.indexOf(cameraRef.current) + 1) % cameras.length];
    cameraRef.current = next;
    setCamera(next);
  }

  function toggleRearView() {
    const current = cameraRef.current;
    if (current !== "Rear") previousView.current = current;
    const next = current === "Rear" ? previousView.current : "Rear";
    cameraRef.current = next;
    setCamera(next);
  }

  function saveGarage(next: GarageState) {
    garageRef.current = next;
    setGarage(next);
    try { localStorage.setItem(garageKey, JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
  }

  function applyGarage() {
    const { cars, active } = garageRef.current;
    setVehicle(cars[active]);
  }

  // Android back button: close the top dialog, otherwise step back through the game's own screens.
  const backButton = useRef<() => void>(() => {});
  backButton.current = () => {
    const open = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].filter((element) => element !== dialog.current);
    if (open.length) {
      open[open.length - 1].close();
      return;
    }
    const current = overlayRef.current;
    if (current === "levels") {
      if (started) dismissLevels();
      else void App.minimizeApp();
    } else if (current === null) showOverlay("pause");
    else if (current === "pause") showOverlay(null);
    else showOverlay("levels");
  };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = App.addListener("backButton", () => backButton.current());
    return () => { void listener.then((handle) => handle.remove()); };
  }, []);

  function dismissLevels() {
    applyGarage();
    showOverlay(drive.current.result);
  }

  function changeLevel(index: number) {
    if (index < 0 || index > lastUnlocked) return;
    const next = upcomingTrial.current;
    const newLevel = index === levelIndex ? level : levels[index]
      ?? (next?.index === index ? next.level : createEndlessTrial(levels, index + 1).level);
    applyGarage();
    setStarted(true);
    drive.current = createDriveState(newLevel.start);
    hadInput.current = false;
    setView({ ...drive.current });
    gearRef.current = "D";
    setGear("D");
    audio.current?.reset();
    if (index !== levelIndex) {
      running.current = false;
      setStatus("loading");
      if (levelIndex < levels.length && index >= levels.length && cameraRef.current === "Overview"
        && window.matchMedia("(max-width: 700px) and (orientation: portrait)").matches) {
        cameraRef.current = "Chase";
        setCamera("Chase");
      }
      setTrial({ index, level: newLevel });
    }
    showOverlay(null);
  }

  useEffect(() => {
    ratingsRef.current = readRatings();
    setRatings(ratingsRef.current);
    endlessProgress.current = readEndlessProgress();
    setEndlessCleared(endlessProgress.current);
    const player = new ParkingAudio(setSoundReady);
    audio.current = player;
    try {
      garageRef.current = readGarage(localStorage.getItem(garageKey));
      setGarage(garageRef.current);
      const enabled = localStorage.getItem(audioKey) !== "off";
      player.setEnabled(enabled);
      setSoundEnabled(enabled);
    } catch { /* Storage may be unavailable. */ }
    return () => {
      player.dispose();
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;
    running.current = false;
    setStatus("loading");
    const abort = new AbortController();
    let frame = 0;
    let scene: Awaited<ReturnType<typeof import("@/lib/utils/parking-scene").createParkingScene>> | undefined;
    let previous = 0;
    let frameDebt = 0;
    let nextStatus = 0;
    let lastRender = 0;
    let renderUntil = 0;
    let previousCamera: CameraMode | undefined;
    let previousImpact = false;

    const animate = (now: number) => {
      const dt = previous ? Math.min((now - previous) / 1000, 0.15) : 1 / 60;
      previous = now;
      if (overlayRef.current === "levels" || helpDialog.current?.open) {
        frameDebt = 0;
        frame = requestAnimationFrame(animate);
        return;
      }

      const { keys, buttons, wheel } = control.current;
      const left = keys.has("KeyA") || keys.has("ArrowLeft") || buttons.has("left");
      const right = keys.has("KeyD") || keys.has("ArrowRight") || buttons.has("right");
      const forward = keys.has("KeyW") || keys.has("ArrowUp");
      const backward = keys.has("KeyS") || keys.has("ArrowDown");
      const accelerating = forward || backward || buttons.has("pedal");
      const braking = keys.has("Space") || buttons.has("brake");
      const steering = wheel ?? Number(right) - Number(left);
      if (accelerating) hadInput.current = true;

      const state = drive.current;
      const previousStop = state.stopIndex;
      if (hadInput.current && !overlayRef.current && !state.result) {
        audio.current?.brake(braking, state.speed);
        frameDebt += dt;
        while (frameDebt >= step) {
          advanceDrive(state, {
            steering,
            brake: braking,
            throttle: accelerating,
            gear: backward && gearRef.current === "D" ? "R" : gearRef.current,
          }, level, step, 0, vehicle.id);
          frameDebt -= step;
        }
      } else {
        frameDebt = 0;
        if (!overlayRef.current) state.steering += (steering - state.steering) * (1 - Math.exp(-14 * dt));
      }

      const mode = cameraRef.current;
      const hasImpact = Boolean(state.impactAt);
      const steeringActive = !state.result && (Math.abs(state.steering) > 0.005 || wheel !== null);
      if (mode !== previousCamera || Math.abs(state.speed) > 0.001 || steeringActive) {
        renderUntil = now + 520;
        previousCamera = mode;
      }
      if (hasImpact !== previousImpact) {
        renderUntil = now + 940;
        previousImpact = hasImpact;
      }
      if (now < renderUntil || now - lastRender > 80) {
        scene?.render(state, mode, lastRender ? Math.min((now - lastRender) / 1000, 0.15) : dt);
        lastRender = now;
      }
      const advancedStop = state.stopIndex !== previousStop;
      if (advancedStop) audio.current?.cue("shift");
      if (now >= nextStatus || advancedStop || (state.result && !overlayRef.current)) {
        setView({ ...state });
        audio.current?.sync(state.speed, accelerating, !overlayRef.current && !state.result && !document.hidden);
        nextStatus = now + (steeringActive ? 16 : 90);
      }

      if (state.result && !overlayRef.current) {
        showOverlay(state.result);
        audio.current?.cue(state.result === "parked" ? "success" : "crash");
        if (state.result === "parked" && levelIndex < levels.length) {
          const best = { ...ratingsRef.current, [level.id]: 3 };
          ratingsRef.current = best;
          setRatings(best);
          try { localStorage.setItem(progressKey, JSON.stringify(best)); } catch { /* Storage may be unavailable. */ }
        } else if (state.result === "parked") {
          const advanced = levelIndex - levels.length + 1;
          if (advanced > endlessProgress.current) {
            endlessProgress.current = advanced;
            setEndlessCleared(advanced);
            try { localStorage.setItem(endlessProgressKey, String(advanced)); } catch { /* Storage may be unavailable. */ }
          }
        }
      }
      frame = requestAnimationFrame(animate);
    };

    import("@/lib/utils/parking-scene")
      .then((module) => module.createParkingScene(host, level, vehicle, abort.signal))
      .then((created) => {
        if (abort.signal.aborted) {
          created.dispose();
          return;
        }
        scene = created;
        scene.render(drive.current, cameraRef.current, 1 / 60);
        running.current = true;
        setStatus("ready");
        frame = requestAnimationFrame(animate);
      })
      .catch(() => {
        if (!abort.signal.aborted) setStatus("error");
      });
    return () => {
      abort.abort();
      cancelAnimationFrame(frame);
      scene?.dispose();
      clearInputs();
    };
  }, [level, revision, started, vehicle]);

  useEffect(() => {
    function keyDown(event: globalThis.KeyboardEvent) {
      const { code } = event;
      if (!running.current || helpDialog.current?.open || event.ctrlKey || event.metaKey || event.altKey) return;
      if (overlayRef.current === "levels") {
        if (code === "Escape" && !event.repeat) {
          event.preventDefault();
          dismissLevels();
        }
        return;
      }
      if (dialog.current?.open && code !== "Escape") return;
      if (event.target instanceof HTMLButtonElement && code === "Space" && Math.abs(drive.current.speed) < 0.05) return;
      if (event.defaultPrevented) return;
      if (movementKeys.has(code)) {
        event.preventDefault();
        if (!overlayRef.current) {
          control.current.keys.add(code);
          if (code === "KeyW" || code === "KeyS" || code === "ArrowUp" || code === "ArrowDown") {
            audio.current?.unlock(true);
            audio.current?.begin();
          }
        }
      }
      if (event.repeat) return;
      if (code === "KeyC" && overlayRef.current !== "failed") chooseNextCamera();
      if (code === "KeyV" && !overlayRef.current) toggleRearView();
      if (code === "KeyF" && !overlayRef.current) chooseGear(gearRef.current === "R" ? "D" : "R");
      if (code === "Escape") {
        if (!overlayRef.current && document.fullscreenElement === gameRoot.current) return;
        if (!overlayRef.current && gameRoot.current?.dataset.fullscreen === "immersive") {
          event.preventDefault();
          setImmersive(false);
          return;
        }
        if (overlayRef.current === "parked" || overlayRef.current === "failed") return;
        event.preventDefault();
        showOverlay(overlayRef.current ? null : "pause");
      }
    }
    function keyUp(event: globalThis.KeyboardEvent) {
      control.current.keys.delete(event.code);
    }
    function onHidden() {
      if (document.hidden) {
        clearInputs();
        audio.current?.suspend();
      }
    }
    const orientation = window.matchMedia("(orientation: portrait)");
    const screenOrientation = window.screen.orientation;
    let portrait = orientation.matches;
    let angle = screenOrientation?.angle;
    function onRotate() {
      const nextPortrait = orientation.matches;
      const nextAngle = screenOrientation?.angle;
      if (portrait === nextPortrait && angle === nextAngle) return;
      portrait = nextPortrait;
      angle = nextAngle;
      clearInputs();
      // Recreate the control targets to release any pointers captured before rotation.
      setControlLayout((layout) => layout + 1);
    }
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", clearInputs);
    document.addEventListener("visibilitychange", onHidden);
    orientation.addEventListener("change", onRotate);
    screenOrientation?.addEventListener("change", onRotate);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", clearInputs);
      document.removeEventListener("visibilitychange", onHidden);
      orientation.removeEventListener("change", onRotate);
      screenOrientation?.removeEventListener("change", onRotate);
    };
  }, []);

  useEffect(() => {
    const syncFullscreen = () => setNativeFullscreen(document.fullscreenElement === gameRoot.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  async function toggleFullscreen() {
    const root = gameRoot.current;
    if (!root) return;
    if (document.fullscreenElement === root) {
      await document.exitFullscreen().catch(() => {});
    } else if (immersive) {
      setImmersive(false);
    } else {
      if (document.fullscreenEnabled && root.requestFullscreen) {
        try {
          await root.requestFullscreen();
          return;
        } catch { /* Use the available viewport if the browser denies native fullscreen. */ }
      }
      setImmersive(true);
    }
  }

  useEffect(() => {
    const element = dialog.current;
    const modal = overlay === "pause" || overlay === "parked";
    if (modal && !element?.open) element?.showModal();
    if (!modal && element?.open) element.close();
    if (overlay === "levels" && started) entryTitle.current?.focus({ preventScroll: true });
    if (overlay === null) playfield.current?.focus({ preventScroll: true });
  }, [overlay, started]);

  useEffect(() => {
    const next = levelIndex + 1;
    if (overlay !== "parked" || next < levels.length || upcomingTrial.current?.index === next) return;
    const prepare = window.setTimeout(() => {
      upcomingTrial.current = { index: next, level: createEndlessTrial(levels, next + 1).level };
    }, 120);
    return () => window.clearTimeout(prepare);
  }, [levelIndex, levels, overlay]);

  const ready = status === "ready";
  const driveEnabled = ready && !overlay;
  const reviewingImpact = Boolean(view.impactAt);
  const fullscreen = nativeFullscreen || immersive;
  const entryOpen = overlay === "levels";
  const soundLabel = !soundEnabled ? "Unmute sound" : soundReady ? "Mute sound" : "Enable sound";
  const stopCount = (level.stops?.length ?? 0) + 1;
  const bay = activeBay(level, view.stopIndex);
  const objective = view.stopIndex < stopCount - 1 ? "Stop inside this bay to reveal the next parking stop." : level.objective;
  const restart = () => changeLevel(levelIndex);
  function openHelp() {
    const element = helpDialog.current;
    if (!element || element.open) return;
    clearInputs();
    audio.current?.suspend();
    element.showModal();
  }
  function unlockFromControl(target: EventTarget, confirmedTap = false) {
    if (target instanceof Element && !target.closest(".sound-toggle")) audio.current?.unlock(confirmedTap);
  }
  function toggleSound() {
    if (soundEnabled && !soundReady) {
      audio.current?.testSound();
      return;
    }
    const enabled = !soundEnabled;
    setSoundEnabled(enabled);
    audio.current?.setEnabled(enabled);
    if (enabled) {
      audio.current?.testSound();
      if (hadInput.current && !overlayRef.current) audio.current?.begin();
    }
    try { localStorage.setItem(audioKey, enabled ? "on" : "off"); } catch { /* Storage may be unavailable. */ }
  }

  return (
    <section className="game-section" aria-label="Parking game" ref={gameRoot} data-fullscreen={immersive ? "immersive" : undefined}
      onContextMenu={(event) => event.preventDefault()}
      onPointerUpCapture={(event) => unlockFromControl(event.target)} onClickCapture={(event) => unlockFromControl(event.target, true)}>
      {entryOpen && (
        <GameEntry titleRef={entryTitle} cleared={cleared} activeIndex={started ? levelIndex : null}
          lastUnlocked={lastUnlocked} page={trialPage} lastPage={lastPage} onSelect={changeLevel}
          onPage={setTrialPage} onBack={dismissLevels}
          garage={<Garage vehicle={garage.cars[garage.active]}
            onSelect={(active) => saveGarage({ ...garageRef.current, active })}
            onCustomize={(changes) => {
              const { cars, active } = garageRef.current;
              saveGarage({ active, cars: { ...cars, [active]: { ...cars[active], ...changes } } });
            }}
          />}
          trials={Array.from({ length: levels.length }, (_, position) => {
            const index = pageStart + position;
            const trial = levels[index];
            return {
              index,
              name: trial?.name ?? `Endless trial ${index + 1}`,
              difficulty: difficulty(index),
              locked: index > lastUnlocked,
              stars: trial ? ratings[trial.id] ?? 0 : index < levels.length + endlessCleared ? 3 : 0,
            };
          })}
        />
      )}
      {entryOpen && (
        <button type="button" className="hud-button entry-more" aria-label="More options" aria-haspopup="dialog"
          aria-controls="game-help" title="Keyboard shortcuts and credits" onClick={openHelp}><Icon name="more" /></button>
      )}
      {started && <div className="viewport" ref={playfield} tabIndex={-1} hidden={entryOpen} role="group"
        data-camera={reviewingImpact ? "Impact" : camera} data-impact={view.impact ?? undefined}
        aria-label={reviewingImpact && view.impact ? `Impact camera. ${impactNames[view.impact]} collision.`
          : `${camera === "Rear" ? "Rear camera" : "3D parking lot"}. Target bay ${bay.id}. ${objective}`}>
        <div className="canvas-host" ref={canvasHost} />
        {status === "loading" && (
          <div className="scene-skeleton" role="status">
            <div className="skeleton-bays"><i /><i /><i /><i /><i /></div>
            <span>Loading parking lot</span>
          </div>
        )}
        {status === "error" && (
          <div className="scene-error" role="alert">
            <h3>The 3D lot could not load</h3>
            <p>Try reloading the models in a browser with WebGL enabled.</p>
            <div className="dialog-actions">
              <button type="button" className="primary" onClick={() => { setStatus("loading"); setRevision((value) => value + 1); }}>Retry</button>
              <button type="button" className="utility-button" onClick={() => showOverlay("levels")}>Levels</button>
            </div>
          </div>
        )}
        <div className="hud-top">
          {reviewingImpact && (
            <div className="impact-camera-label"><Icon name="camera" size={17} /> Impact Cam</div>
          )}
          <div className="view-actions">
            <button type="button" className="hud-button sound-toggle" data-pending={soundEnabled && !soundReady} onClick={toggleSound} aria-label={soundLabel} title={soundLabel}>
              <Icon name={soundEnabled ? "sound" : "muted"} />
              {soundEnabled && !soundReady && <span>Enable sound</span>}
            </button>
            {!reviewingImpact && <>
              <button type="button" className="hud-button" onClick={chooseNextCamera} aria-label={`Change camera. Current view: ${camera}`} title={`Camera: ${camera}`} disabled={!ready}><Icon name="camera" /></button>
              <button type="button" className="hud-button" onClick={toggleRearView} aria-label="Rear view" aria-pressed={camera === "Rear"} title="Rear view (V)" disabled={!ready}><Icon name="rear" /></button>
              <button type="button" className="hud-button" onClick={() => showOverlay("pause")} aria-label="Pause game" disabled={!ready}><Icon name="pause" /></button>
            </>}
            <button className="hud-button fullscreen-button" type="button" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={() => void toggleFullscreen()}>
              <Icon name={fullscreen ? "collapse" : "expand"} />
            </button>
            <button className="hud-button" type="button" aria-label="More options" aria-haspopup="dialog"
              aria-controls="game-help" title="Keyboard shortcuts and credits" onClick={openHelp}><Icon name="more" /></button>
          </div>
        </div>
        <div className="cockpit" hidden={reviewingImpact}>
          <div className="telemetry">
            <div className="speed"><strong>{Math.round(Math.abs(view.speed) * 3.6)}</strong><span>km/h</span></div>
            {stopCount > 1 && <span className="run-indicator">{`Stop ${view.stopIndex + 1} of ${stopCount}`}</span>}
          </div>
          <DriveControls key={controlLayout} active={driveEnabled} gear={gear} steering={view.steering} onGear={chooseGear}
            onSteer={(value) => { control.current.wheel = value; }}
            onAction={(action, active) => {
              if (active) {
                control.current.buttons.add(action);
                if (action === "pedal") audio.current?.begin();
              }
              else control.current.buttons.delete(action);
            }} />
        </div>
        {reviewingImpact && (
          <section className="impact-panel" aria-labelledby="impact-title">
            <div role="status">
              <h3 id="impact-title">Game Over</h3>
              <p>{view.impact && `${impactNames[view.impact]} collision`}</p>
            </div>
            <div className="dialog-actions">
              <button className="primary" type="button" onClick={restart}><Icon name="reset" size={18} /> Retry</button>
              <button className="utility-button" type="button" onClick={() => showOverlay("levels")}><Icon name="levels" size={18} /> Levels</button>
            </div>
          </section>
        )}
      </div>}
      <dialog className="game-dialog" data-state={overlay ?? undefined} aria-labelledby="dialog-title" ref={dialog} onCancel={(event) => {
        event.preventDefault();
        if (overlay === "pause") showOverlay(null);
      }}>
        {overlay === "pause" && (
          <>
            <h2 id="dialog-title">Paused</h2>
            <div className="dialog-actions">
              <button type="button" className="primary" autoFocus onClick={() => showOverlay(null)}><Icon name="play" /> Resume</button>
              <button type="button" className="utility-button" onClick={restart}><Icon name="reset" /> Restart</button>
              <button type="button" className="utility-button" onClick={() => showOverlay("levels")}><Icon name="levels" /> Levels</button>
            </div>
          </>
        )}
        {overlay === "parked" && (
          <>
            <h2 id="dialog-title">Parked cleanly</h2>
            <div className="result-summary"><p className="result-stars" aria-label="3 of 3 stars">★★★</p><span>{formatTime(view.elapsed)}</span></div>
            {levelIndex === levels.length - 1 && <p>Endless trials unlocked.</p>}
            <div className="dialog-actions">
              <button type="button" className="primary" onClick={() => changeLevel(levelIndex + 1)}>Next trial <Icon name="right" /></button>
              <button type="button" className="utility-button" onClick={restart}><Icon name="reset" /> Retry</button>
              <button type="button" className="utility-button" onClick={() => showOverlay("levels")}><Icon name="levels" /> Levels</button>
            </div>
          </>
        )}
      </dialog>
      <GameHelp dialogRef={helpDialog} />
    </section>
  );
}
