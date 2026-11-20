"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Icon } from "@/components/ui/icon";
import { vehicles } from "@/lib/utils/garage";
import { vehicleIds, type VehicleId, type VehicleSelection } from "@/types/vehicle";

type Preview = ReturnType<typeof import("@/lib/utils/garage-preview").createGaragePreview>;
type Customization = Partial<Pick<VehicleSelection, "color" | "roof">>;

interface GarageProps {
  vehicle: VehicleSelection;
  onSelect: (id: VehicleId) => void;
  onCustomize: (changes: Customization) => void;
}

export function Garage({ vehicle, onSelect, onCustomize }: GarageProps) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const catalog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadStatus, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadedId, setLoadedId] = useState<VehicleId | null>(null);
  const [revision, setRevision] = useState(0);
  const id = vehicle.id;
  const model = vehicles[id];
  const index = vehicleIds.indexOf(id);
  const matches = vehicleIds.filter((choice) => vehicles[choice].name.toLowerCase().includes(search.trim().toLowerCase()));
  const status = loadStatus === "ready" && loadedId !== id ? "loading" : loadStatus;

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const abort = new AbortController();
    let stage: Preview | undefined;
    import("@/lib/utils/garage-preview").then(({ createGaragePreview }) => {
      if (abort.signal.aborted) return;
      stage = createGaragePreview(target);
      setPreview(stage);
    }).catch(() => {
      if (!abort.signal.aborted) setStatus("error");
    });
    return () => { abort.abort(); stage?.dispose(); };
  }, [revision]);

  useEffect(() => {
    if (!preview) return;
    const abort = new AbortController();
    setStatus("loading");
    preview.select(id, abort.signal).then(() => {
      if (abort.signal.aborted) return;
      setLoadedId(id);
      setStatus("ready");
    }).catch(() => {
      if (!abort.signal.aborted) setStatus("error");
    });
    return () => abort.abort();
  }, [preview, id]);

  useEffect(() => preview?.customize(vehicle), [preview, vehicle]);

  return (
    <section className="garage" aria-labelledby="garage-heading">
      <h2 id="garage-heading">Garage</h2>
      <div className="garage-preview" aria-label={`3D preview of ${model.name}`} aria-busy={status === "loading"}>
        <div className="garage-model" ref={host}
          onPointerDown={(event) => {
            if (event.button !== 0 || status !== "ready") return;
            drag.current = event.clientX;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            preview?.rotate((event.clientX - drag.current) * 0.012);
            drag.current = event.clientX;
          }}
          onLostPointerCapture={() => { drag.current = null; }}
        />
        {status === "loading" && <div className="garage-placeholder" role="status"><span className="sr-only">Loading car preview</span></div>}
        {status === "error" && <div className="garage-error" role="status">
          <span>Car preview unavailable</span>
          <button type="button" className="utility-button" onClick={() => {
            setStatus("loading");
            setPreview(null);
            setRevision((value) => value + 1);
          }}>Retry preview</button>
        </div>}
        {status === "ready" && <div className="garage-orbit" role="group" aria-label="Rotate car preview">
          <button type="button" className="hud-button" aria-label="Rotate car left" onClick={() => preview?.rotate(-0.6)}><Icon name="left" size={17} /></button>
          <button type="button" className="hud-button" aria-label="Rotate car right" onClick={() => preview?.rotate(0.6)}><Icon name="right" size={17} /></button>
        </div>}
      </div>
      <div className="garage-picker">
        <button type="button" className="hud-button" aria-label="Previous car"
          onClick={() => onSelect(vehicleIds[(index + vehicleIds.length - 1) % vehicleIds.length])}><Icon name="left" size={17} /></button>
        <button type="button" className="garage-picker-button" aria-label="Car model" aria-haspopup="dialog"
          onClick={() => catalog.current?.showModal()}>
          <span>{model.name}</span><span aria-hidden="true">▾</span>
        </button>
        <button type="button" className="hud-button" aria-label="Next car"
          onClick={() => onSelect(vehicleIds[(index + 1) % vehicleIds.length])}><Icon name="right" size={17} /></button>
      </div>
      <dialog ref={catalog} className="garage-catalog" aria-labelledby="garage-catalog-title" onClose={() => setSearch("")}>
        <div className="garage-catalog-heading">
          <h3 id="garage-catalog-title">Choose a car</h3>
          <button type="button" className="hud-button" aria-label="Close car list" onClick={() => catalog.current?.close()}>×</button>
        </div>
        <input className="garage-search" aria-label="Search cars" type="search" value={search}
          placeholder="Search cars" onChange={(event) => setSearch(event.currentTarget.value)} />
        <div className="garage-grid">
          {matches.map((choice) => (
            <button key={choice} type="button" data-car={choice} className="garage-card" aria-pressed={choice === id}
              onClick={() => { onSelect(choice); catalog.current?.close(); }}>
              <Image src={`/garage-thumbnails/${choice}.webp`} width={320} height={152} alt="" unoptimized draggable={false} />
              <span>{vehicles[choice].name}</span>
            </button>
          ))}
          {matches.length === 0 && <p role="status">No cars found</p>}
        </div>
      </dialog>
      {(model.paint || model.roof !== undefined) && <div className="garage-options">
        {model.paint && <label className="garage-color">
          <input type="color" value={vehicle.color} onChange={(event) => onCustomize({ color: event.currentTarget.value })} />
          <span>Paint color <output>{vehicle.color.toUpperCase()}</output></span>
        </label>}
        {model.roof !== undefined && <div className="garage-segment" role="group" aria-label="Roof">
          <button type="button" className="utility-button" aria-pressed={vehicle.roof} onClick={() => onCustomize({ roof: true })}>Roof on</button>
          <button type="button" className="utility-button" aria-pressed={!vehicle.roof} onClick={() => onCustomize({ roof: false })}>Open top</button>
        </div>}
      </div>}
    </section>
  );
}
