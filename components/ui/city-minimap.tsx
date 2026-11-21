import { avenues, cityBounds, streets } from "@/lib/utils/city-rules";
import type { CityPlace } from "@/lib/utils/city-scene";
import type { Pose } from "@/types/game";

const landmarkColors: Record<string, string> = {
  station: "#e9b9ff", bus_stop: "#82dcfa", restaurant: "#ffc66b", cafe: "#ffc66b",
  park: "#8ddb97", beach: "#ffe5a9", harbour: "#ffe5a9", hills: "#8ddb97", shop: "#a3d9ec",
};
const bounds = cityBounds;

export function CityMinimap({ places, pose }: { places: CityPlace[]; pose: Pose }) {
  return (
    <figure className="city-map" aria-label="City minimap">
      <svg viewBox={[bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top].join(" ")}
        role="img" aria-label="Roads, rail line, bus stops, stations, restaurant, park and beach">
        <rect x={bounds.left} y={bounds.top} width={254} height={366} fill="#233d35" />
        <path d="M-127 126H-60L-52 113Q-28 129 10 125T127 133V179H-127Z" fill="#264f63" />
        <path d="M-53 108Q-30 121 10 118T127 124V133Q62 121 10 125T-52 113Z" fill="#ab976b" />
        <path d="M-116-104V104" stroke="#b780d6" strokeWidth="3" strokeDasharray="5 4" />
        <g stroke="#b1af9b" strokeWidth="8" opacity=".79">
          {streets.map((z) => <path key={z} d={["M", -106, z, "H", 106].join(" ")} />)}
          {avenues.map((x) => <path key={x} d={["M", x, -89, "V", 91].join(" ")} />)}
          <path d="M-99-89V-96Q-77-129-49-133Q-27-139 0-139T49-133Q77-128 99-96V-89" fill="none" strokeWidth="5" />
          <path d="M69 104V161" strokeWidth="4" />
        </g>
        {places.filter(({ kind }) => landmarkColors[kind]).map(({ name, kind, x, z }) => (
          <circle key={kind + name} cx={x} cy={z} r={5} fill={landmarkColors[kind]} stroke="#101a18" strokeWidth="2">
            <title>{name}</title>
          </circle>
        ))}
        <path d="M0-10 7 8 0 5-7 8Z" fill="#fff4e0" stroke="#141b17" strokeWidth="1.75"
          transform={["translate(", pose.x, pose.z, ") rotate(", -pose.yaw * 180 / Math.PI, ")"].join(" ")} />
      </svg>
      <figcaption>
        <span><i style={{ background: landmarkColors.bus_stop }} />Bus</span>
        <span><i style={{ background: landmarkColors.station }} />Rail</span>
        <span><i style={{ background: landmarkColors.restaurant }} />Dining</span>
        <span><i style={{ background: landmarkColors.shop }} />Shop</span>
        <span><i style={{ background: landmarkColors.park }} />Park</span>
        <span><i style={{ background: landmarkColors.beach }} />Coast</span>
      </figcaption>
    </figure>
  );
}
