export function LoadingGame() {
  return (
    <main className="game-shell" aria-busy="true" aria-label="Loading Parkline">
      <div className="game-entry" aria-hidden="true">
        <div className="entry-intro"><div className="loading-top" /><div className="loading-lot" /></div>
        <div className="entry-trials">
          <div className="loading-top" />
          <div className="trial-list">
            {Array.from({ length: 10 }, (_, index) => <div key={index} className="loading-trial" />)}
          </div>
        </div>
      </div>
    </main>
  );
}
