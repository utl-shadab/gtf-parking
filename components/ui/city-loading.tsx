export function CityLoading() {
  return (
    <div className="scene-skeleton city-skeleton" role="status">
      <div className="city-skeleton-grid" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
      </div>
      <span>Loading Open City…</span>
    </div>
  );
}
