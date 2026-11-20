import type { ReactNode } from "react";

type IconName = "parking" | "camera" | "rear" | "pause" | "reset" | "back" | "right" | "left" | "levels" | "play" | "expand" | "collapse" | "sound" | "muted" | "lock" | "more" | "close";

const icons: Record<IconName, ReactNode> = {
  parking: <path d="M8 18V6h5a3.5 3.5 0 0 1 0 7H8" />,
  camera: <><path d="M4 7h4l2-2h4l2 2h4v12H4z" /><circle cx="12" cy="13" r="3" /></>,
  rear: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M15 12H9m3-3-3 3 3 3" /></>,
  pause: <><path d="M9 6v12M15 6v12" strokeWidth="3" /></>,
  reset: <><path d="M4 11a8 8 0 1 1 2.4 6.1M4 5v6h6" /></>,
  back: <path d="M20 12H4m7-7-7 7 7 7" />,
  right: <path d="m9 5 7 7-7 7" />,
  left: <path d="m15 5-7 7 7 7" />,
  levels: <><rect x="4" y="4" width="5" height="5" rx="1" /><rect x="15" y="4" width="5" height="5" rx="1" /><rect x="4" y="15" width="5" height="5" rx="1" /><rect x="15" y="15" width="5" height="5" rx="1" /></>,
  play: <path d="m9 5 11 7-11 7z" />,
  expand: <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" />,
  collapse: <path d="M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5" />,
  sound: <><path d="M3 9h4l5-4v14l-5-4H3z" /><path d="M16 9a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12" /></>,
  muted: <><path d="M3 9h4l5-4v14l-5-4H3z" /><path d="m16 9 5 6m0-6-5 6" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  more: <path d="M5 12h.01m6.99 0h.01m6.99 0h.01" strokeWidth="3" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
};

export function Icon({ name, size = 21 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
}
