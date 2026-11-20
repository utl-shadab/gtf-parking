"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";

export interface ApkInfo {
  href: string;
  size: number;
}

const dismissedKey = "parkline:install-dismissed";
const remindAfter = 7 * 24 * 60 * 60 * 1000;

function shouldOffer() {
  // APKs only install on Android; iPhone and desktop visitors never see the offer.
  if (!/Android/i.test(navigator.userAgent)) return false;
  try {
    const dismissed = Number(localStorage.getItem(dismissedKey));
    return !dismissed || Date.now() - dismissed > remindAfter;
  } catch {
    return true;
  }
}

export function InstallPrompt({ apk }: { apk: ApkInfo }) {
  const sheet = useRef<HTMLDialogElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<"offer" | "downloading">("offer");

  // The Install link unmounts when the step changes; keep focus inside the sheet.
  useEffect(() => {
    if (step === "downloading") done.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!shouldOffer()) return;
    const timer = window.setTimeout(() => {
      sheet.current?.showModal();
      // Focus the sheet, not its first button: screen readers announce the title, and no focus ring flashes on load.
      sheet.current?.focus();
    }, 900);
    return () => window.clearTimeout(timer);
  }, []);

  function dismiss() {
    try { localStorage.setItem(dismissedKey, String(Date.now())); } catch { /* Storage may be unavailable. */ }
    sheet.current?.close();
  }

  const size = new Intl.NumberFormat(undefined, { style: "unit", unit: "megabyte", unitDisplay: "short", maximumFractionDigits: 0 })
    .format(Math.max(1, apk.size / 1048576));

  return (
    <dialog ref={sheet} tabIndex={-1} className="install-sheet" data-step={step} aria-labelledby="install-title" aria-describedby="install-summary"
      onCancel={(event) => { event.preventDefault(); dismiss(); }}>
      <img className="install-mark" src="/parkline-mark.svg" width={64} height={64} alt="" />
      {step === "offer" ? (
        <>
          <div className="install-copy">
            <h2 id="install-title">Get the Android app</h2>
            <p id="install-summary">Play full screen with no browser bars, even offline.</p>
          </div>
          <p className="install-meta">Free download, {size}. Needs Android 7 or later. The app keeps its own progress, separate from this browser.</p>
          <div className="dialog-actions">
            <a className="primary" href={apk.href} download="parkline.apk" type="application/vnd.android.package-archive"
              onClick={() => setStep("downloading")}>
              <Icon name="download" size={18} /> Install app
            </a>
            <button type="button" className="utility-button" onClick={dismiss}>Not now</button>
          </div>
        </>
      ) : (
        <>
          <div className="install-copy" role="status">
            <h2 id="install-title">Downloading <span translate="no">Parkline</span></h2>
            <p>Finish the install from your notifications.</p>
          </div>
          <ol id="install-summary" className="install-steps">
            <li>When the download finishes, open parkline.apk.</li>
            <li>Tap Install. If Android asks, allow installs from your browser.</li>
          </ol>
          <div className="dialog-actions">
            <button type="button" className="primary" ref={done} onClick={dismiss}>Done</button>
          </div>
        </>
      )}
    </dialog>
  );
}
