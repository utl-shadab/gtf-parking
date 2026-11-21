"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import type { Action, Gear } from "@/types/game";
import { isCityPanel, type GarageState, type VehicleId, type VehicleSelection } from "@/types/vehicle";
import { CarCatalog } from "@/components/ui/car-catalog";
import { DriveControls } from "@/components/ui/drive-controls";
import { CityJoystick } from "@/components/ui/city-joystick";
import { CityLoading } from "@/components/ui/city-loading";
import { CityMinimap } from "@/components/ui/city-minimap";
import { Icon } from "@/components/ui/icon";
import { cityDistricts } from "@/lib/utils/city-progress";
import type { CityGraphics } from "@/lib/utils/city-scene";
import type { CityAction, CityFrame, createCitySession } from "@/lib/utils/city-session";
import { readCitySave } from "@/lib/utils/city-save";
import { movementKeys, readDriveInput, type DriveControlsState } from "@/lib/utils/drive-controls";
import type { ParkingAudio } from "@/lib/utils/parking-audio";
import { vehicles } from "@/lib/utils/garage";

type Session = Awaited<ReturnType<typeof createCitySession>>;

interface CityGameProps {
  unlocked: number;
  garage: GarageState;
  startVehicle: VehicleSelection | undefined;
  audio: RefObject<ParkingAudio | null>;
  soundEnabled: boolean;
  soundLabel: string;
  onSound: () => void;
  onExit: () => void;
}

const labels: Record<CityAction, string> = {
  exit: "Exit vehicle", enter: "Enter car", door: "Driver door", trunk: "Trunk", roof: "Toggle roof",
  passengerDoor: "Passenger door", rearDoors: "Rear doors",
  sit: "Sit on bench", stand: "Stand up",
  boardBus: "Board bus", boardTrain: "Board train", leaveTransit: "Get off", skip: "Next stop",
  driveBus: "Drive bus",
};
const modes: Record<CityFrame["mode"], string> = {
  drive: "Driving", walk: "On foot", swim: "Swimming", sit: "Sitting", bus: "Bay Shuttle", train: "Bay Line", driveBus: "Driving the bus",
};
const graphicsModes: CityGraphics[] = ["Low", "Medium", "High"];
const actionPriority: CityAction[] = ["stand", "boardTrain", "boardBus", "enter", "sit", "exit", "leaveTransit", "skip"];

export default function CityGame({ unlocked, garage, startVehicle, audio, soundEnabled, soundLabel, onSound, onExit }: CityGameProps) {
  const host = useRef<HTMLDivElement>(null);
  const playfield = useRef<HTMLElement>(null);
  const pauseDialog = useRef<HTMLDialogElement>(null);
  const carCatalog = useRef<HTMLDialogElement>(null);
  const loadingCarRef = useRef(false);
  const session = useRef<Session | null>(null);
  const latestFrame = useRef<CityFrame | null>(null);
  const controls = useRef<DriveControlsState>({ keys: new Set(), buttons: new Set(), wheel: null });
  const joystick = useRef({ x: 0, z: 0 });
  const gearRef = useRef<Gear>("D");
  const pausedRef = useRef(false);
  const [gear, setGear] = useState<Gear>("D");
  const [paused, setPaused] = useState(false);
  const [graphics, setGraphics] = useState<CityGraphics>("Low");
  const [frame, setFrame] = useState<CityFrame | null>(null);
  const [error, setError] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [loadingCar, setLoadingCar] = useState(false);
  const [revision, setRevision] = useState(0);
  const [controlLayout, setControlLayout] = useState(0);
  const driving = !frame?.transferring && (frame?.mode === "drive" || frame?.mode === "driveBus");
  const onFoot = !frame?.transferring && (frame?.mode === "walk" || frame?.mode === "swim");
  const hour = Math.floor(frame?.hour ?? 0);
  const minute = Math.floor(((frame?.hour ?? 0) - hour) * 60);

  function clearControls() {
    controls.current.keys.clear();
    controls.current.buttons.clear();
    controls.current.wheel = null;
    joystick.current = { x: 0, z: 0 };
  }

  function togglePause(next: boolean) {
    if (!session.current) return;
    pausedRef.current = next;
    session.current.pause(next);
    clearControls();
    setControlLayout((value) => value + 1);
    setPaused(next);
    if (next) audio.current?.suspend();
  }

  function chooseGear(next: Gear) {
    if (gearRef.current !== next) audio.current?.cue("shift");
    gearRef.current = next;
    setGear(next);
  }

  function act(action: CityAction) {
    setActionMessage("");
    clearControls();
    setControlLayout((value) => value + 1);
    if (action === "enter" || action === "driveBus") {
      chooseGear("D");
      audio.current?.begin();
    }
    session.current?.action(action);
    playfield.current?.focus({ preventScroll: true });
  }

  function openCars() {
    if (!session.current || !carCatalog.current || loadingCarRef.current) return;
    clearControls();
    setControlLayout((value) => value + 1);
    session.current.pause(true);
    audio.current?.suspend();
    carCatalog.current.showModal();
  }

  async function chooseCar(id: VehicleId) {
    const city = session.current;
    if (!city || loadingCarRef.current) return;
    const walking = latestFrame.current?.mode === "walk";
    loadingCarRef.current = true;
    setLoadingCar(true);
    setActionMessage("");
    try {
      if (await city.chooseCar(garage.cars[id])) {
        if (!walking) chooseGear("D");
        else setActionMessage(`${vehicles[id].name} is parked nearby.`);
      } else setActionMessage("There’s no room to bring a car here.");
    } catch {
      if (session.current === city) setActionMessage("That car couldn’t load. Try again.");
    } finally {
      loadingCarRef.current = false;
      if (session.current === city) {
        setLoadingCar(false);
        city.pause(false);
        playfield.current?.focus({ preventScroll: true });
      }
    }
  }

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const abort = new AbortController();
    let renderID = 0;
    let previous = 0;
    let nextUpdate = 0;
    function animate(now: number) {
      const city = session.current;
      if (!city) return;
      const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 1 / 60;
      previous = now;
      const { keys } = controls.current;
      const input = readDriveInput(controls.current, gearRef.current);
      const movement = {
        x: joystick.current.x + Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")),
        z: joystick.current.z + Number(input.backward) - Number(input.forward),
        run: keys.has("ShiftLeft") || keys.has("ShiftRight") || Math.hypot(joystick.current.x, joystick.current.z) > 0.83,
      };
      city.tick(input, movement, dt);
      if (now >= nextUpdate) {
        const update = city.frame();
        latestFrame.current = update;
        setFrame(update);
        const engine = update.mode === "drive" || update.mode === "driveBus";
        audio.current?.brake(engine && input.brake, update.speed);
        audio.current?.sync(update.speed, input.throttle, !pausedRef.current && !carCatalog.current?.open
          && !loadingCarRef.current && !document.hidden, engine);
        nextUpdate = now + 75;
      }
      renderID = requestAnimationFrame(animate);
    }
    const saved = readCitySave(garage.cars[garage.active]);
    if (startVehicle) {
      saved.vehicle = startVehicle;
      if (saved.parkedAt) saved.pose = saved.parkedAt;
      saved.parkedAt = undefined;
    }
    import("@/lib/utils/city-session")
      .then((module) => module.createCitySession(element, saved, abort.signal, () => audio.current?.cue("honk")))
      .then((city) => {
        if (abort.signal.aborted) {
          city.dispose();
          return;
        }
        session.current = city;
        playfield.current?.focus({ preventScroll: true });
        renderID = requestAnimationFrame(animate);
      }).catch(() => { if (!abort.signal.aborted) setError(true); });
    const save = () => session.current?.persist();
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", save);
    return () => {
      abort.abort();
      cancelAnimationFrame(renderID);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", save);
      audio.current?.reset();
      session.current?.dispose();
      session.current = null;
      latestFrame.current = null;
    };
  }, [audio, revision, garage, startVehicle]);

  useEffect(() => {
    function keyDown(event: globalThis.KeyboardEvent) {
      if (!session.current || carCatalog.current?.open || loadingCarRef.current
        || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const { code } = event;
      if (code === "Escape" && !event.repeat) {
        event.preventDefault();
        togglePause(!pausedRef.current);
      }
      if (pausedRef.current) return;
      if (code === "Space" && event.target instanceof HTMLButtonElement) return;
      if (movementKeys.has(code) || code === "ShiftLeft" || code === "ShiftRight") {
        event.preventDefault();
        controls.current.keys.add(code);
        const mode = latestFrame.current?.mode;
        if ((mode === "drive" || mode === "driveBus") && ["KeyW", "KeyS", "ArrowUp", "ArrowDown"].includes(code)) audio.current?.begin();
      }
      if (event.repeat) return;
      if (code === "KeyC") session.current.cycleCamera();
      if (code === "KeyV") session.current.rearView();
      if (code === "KeyF") chooseGear(gearRef.current === "R" ? "D" : "R");
      if (code === "KeyE") {
        const action = actionPriority.find((value) => latestFrame.current?.actions.includes(value));
        if (action) act(action);
      }
    }
    const keyUp = (event: globalThis.KeyboardEvent) => controls.current.keys.delete(event.code);
    const blur = () => {
      clearControls();
      setControlLayout((value) => value + 1);
      audio.current?.suspend();
    };
    const orientation = matchMedia("(orientation: portrait)");
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    orientation.addEventListener("change", blur);
    document.addEventListener("visibilitychange", blur);
    const listener = Capacitor.isNativePlatform()
      ? App.addListener("backButton", () => {
        if (carCatalog.current?.open) carCatalog.current.close();
        else if (session.current) {
          if (!loadingCarRef.current) togglePause(!pausedRef.current);
        } else onExit();
      })
      : undefined;
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
      orientation.removeEventListener("change", blur);
      document.removeEventListener("visibilitychange", blur);
      if (listener) void listener.then((handle) => handle.remove());
    };
  }, [audio, onExit]);

  useEffect(() => {
    const dialog = pauseDialog.current;
    if (paused && !dialog?.open) dialog?.showModal();
    else if (!paused && dialog?.open) {
      dialog.close();
      playfield.current?.focus({ preventScroll: true });
    }
  }, [paused]);

  return (
    <section ref={playfield} tabIndex={-1} className="viewport city-viewport" aria-label="Open City free roam">
      <div className="canvas-host" ref={host} />
      {!frame && !error && <CityLoading />}
      {error && <div className="scene-error" role="alert">
        <h2>Open City could not load</h2>
        <div className="dialog-actions">
          <button type="button" className="primary" onClick={() => { setError(false); setRevision((value) => value + 1); }}>Retry</button>
          <button type="button" className="utility-button" onClick={onExit}>Back to levels</button>
        </div>
      </div>}
      {frame && <>
        <div className="hud-top city-hud">
          <div className="city-hud-info">
            <div className="city-status">
              <h2>Open City</h2>
              <span>{frame.transferring ? frame.mode === "drive" ? "Getting out" : "Getting in" : modes[frame.mode]} · {String(hour).padStart(2, "0")}:{String(minute).padStart(2, "0")}</span>
              {frame.mode === "drive" && <span>{vehicles[frame.vehicle].name}</span>}
              <span>Traffic violations {frame.violations}</span>
            </div>
            <CityMinimap places={session.current?.places ?? []} pose={frame} />
          </div>
          <div className="view-actions">
            {frame.canChooseCar && <button type="button" className="hud-button" onClick={openCars}
              disabled={loadingCar} aria-label="Choose a city car" title="Choose a car" aria-haspopup="dialog">
              <Icon name="car" />
            </button>}
            <button type="button" className="hud-button sound-toggle" onClick={onSound} aria-label={soundLabel} title={soundLabel}>
              <Icon name={soundEnabled ? "sound" : "muted"} />
            </button>
            {driving && <button type="button" className="hud-button" onClick={() => session.current?.cycleCamera()} aria-label="Change city camera" title="Camera (C)">
              <Icon name="camera" />
            </button>}
            <button type="button" className="hud-button" disabled={loadingCar} onClick={() => togglePause(true)} aria-label="Pause city" aria-haspopup="dialog">
              <Icon name="pause" />
            </button>
          </div>
        </div>
        <div className="city-alert" role="status">{loadingCar ? "Loading car…" : frame.warning || actionMessage}</div>
        <div className="city-interactions" data-driving={driving} data-on-foot={onFoot || frame.mode === "sit"}>
          {frame.transit && <p className="city-destination">Stop · {frame.transit}</p>}
          {frame.mode === "swim" && <label className="city-stamina">Stamina <progress max={100} value={Math.round(frame.stamina)} /></label>}
          {frame.actions.map((action) => (
            <button className="hud-button" type="button" disabled={loadingCar} key={action} onClick={() => act(action)}
              aria-pressed={isCityPanel(action) ? frame.panels[action] : undefined}>
              {action === "trunk" && frame.frontLid ? "Front trunk" : labels[action]}
            </button>
          ))}
        </div>
        {driving && <div className="cockpit">
          <div className="telemetry"><div className="speed"><strong>{Math.round(Math.abs(frame.speed) * 3.6)}</strong><span>km/h</span></div></div>
          <DriveControls key={controlLayout} steering={frame.steering} gear={gear} active={!paused && !loadingCar} onGear={chooseGear}
            onSteer={(value) => { controls.current.wheel = value; }}
            onAction={(action: Action, active) => {
              if (!active) controls.current.buttons.delete(action);
              else {
                controls.current.buttons.add(action);
                if (action === "pedal") audio.current?.begin();
              }
            }} />
        </div>}
        {onFoot && !paused && !loadingCar && <CityJoystick key={controlLayout} onMove={(value) => { joystick.current = value; }} />}
      </>}
      <CarCatalog dialog={carCatalog} selected={frame?.vehicle ?? garage.active} onSelect={(id) => void chooseCar(id)}
        onClose={() => {
          if (!loadingCarRef.current && !pausedRef.current) session.current?.pause(false);
        }} />
      <dialog className="game-dialog city-dialog" ref={pauseDialog} aria-labelledby="city-pause-title" onCancel={(event) => {
        event.preventDefault();
        togglePause(false);
      }}>
        <h2 id="city-pause-title">City paused</h2>
        <label className="city-graphics">Graphics <select value={graphics} onChange={(event) => {
          const next = graphicsModes.find((mode) => mode === event.target.value);
          if (!next) return;
          session.current?.setGraphics(next);
          setGraphics(next);
        }}>{graphicsModes.map((mode) => <option key={mode}>{mode}</option>)}</select></label>
        <fieldset className="city-travel">
          <legend>Fast travel</legend>
          {cityDistricts.slice(0, unlocked).map((name, index) => (
            <button key={name} type="button" className="utility-button" onClick={() => {
              session.current?.travel(index);
              chooseGear("D");
              togglePause(false);
            }}>{name}</button>
          ))}
        </fieldset>
        <div className="dialog-actions">
          <button type="button" className="primary" onClick={() => togglePause(false)}><Icon name="play" />Resume</button>
          <button type="button" className="utility-button" onClick={onExit}><Icon name="levels" />Back to levels</button>
        </div>
      </dialog>
    </section>
  );
}
