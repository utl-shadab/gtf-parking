import type { Ref } from "react";
import { Icon } from "./icon";

const shortcuts = [
  { action: "Drive", keys: ["W", "A", "S", "D"] },
  { action: "Brake", keys: ["Space"] },
  { action: "Reverse gear", keys: ["F"] },
  { action: "Change camera", keys: ["C"] },
  { action: "Rear view", keys: ["V"] },
  { action: "Pause", keys: ["Esc"] },
];

export function GameHelp({ dialogRef }: { dialogRef: Ref<HTMLDialogElement> }) {
  return (
    <dialog id="game-help" className="game-help" ref={dialogRef} aria-labelledby="game-help-title"
      onClick={(event) => {
        const dialog = event.currentTarget;
        if (event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
      }}>
      <header className="help-heading">
        <h2 id="game-help-title">Keyboard shortcuts</h2>
        <form method="dialog">
          <button className="utility-button" type="submit" aria-label="Close shortcuts"><Icon name="close" size={18} /></button>
        </form>
      </header>
      <dl className="shortcut-list">
        {shortcuts.map(({ action, keys }) => (
          <div key={action}>
            <dt>{action}</dt>
            <dd>{keys.map((key) => <kbd key={key}>{key}</kbd>)}</dd>
          </div>
        ))}
      </dl>
      <a className="help-credits" href="/credits.txt" target="_blank" rel="noopener">
        Asset credits <span className="sr-only">(opens in a new tab)</span><Icon name="right" size={16} />
      </a>
    </dialog>
  );
}
