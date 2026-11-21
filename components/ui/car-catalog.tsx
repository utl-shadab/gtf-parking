"use client";

import { useId, useState, type RefObject } from "react";
import Image from "next/image";
import { Icon } from "./icon";
import { vehicles } from "@/lib/utils/garage";
import { vehicleIds, type VehicleId } from "@/types/vehicle";

interface CarCatalogProps {
  dialog: RefObject<HTMLDialogElement | null>;
  selected: VehicleId;
  onSelect: (id: VehicleId) => void;
  onClose?: () => void;
}

export function CarCatalog({ dialog, selected, onSelect, onClose }: CarCatalogProps) {
  const titleId = useId();
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const matches = vehicleIds.filter((id) => vehicles[id].name.toLowerCase().includes(query));

  return (
    <dialog ref={dialog} className="garage-catalog" aria-labelledby={titleId} onClose={() => {
      setSearch("");
      onClose?.();
    }}>
      <div className="garage-catalog-heading">
        <h2 id={titleId}>Choose from {vehicleIds.length} cars</h2>
        <button type="button" className="hud-button" aria-label="Close car list" onClick={() => dialog.current?.close()}>
          <Icon name="close" />
        </button>
      </div>
      <input className="garage-search" aria-label="Search cars" autoComplete="off" type="search" value={search}
        placeholder="Search cars…" onChange={(event) => setSearch(event.currentTarget.value)} />
      <div className="garage-grid">
        {matches.map((id) => (
          <button key={id} type="button" data-car={id} className="garage-card" aria-pressed={id === selected}
            onClick={() => { onSelect(id); dialog.current?.close(); }}>
            <Image src={`/garage-thumbnails/${id}.webp`} width={320} height={152} sizes="(max-width: 560px) 40vw, 220px"
              alt="" unoptimized draggable={false} />
            <span>{vehicles[id].name}</span>
          </button>
        ))}
        {matches.length === 0 && <p role="status">No cars found</p>}
      </div>
    </dialog>
  );
}
