"use client";

export function GameError({ reset }: { reset: () => void }) {
  return (
    <main className="error-screen">
      <h1>Parkline could not load</h1>
      <button className="primary" onClick={reset}>Try again</button>
    </main>
  );
}
