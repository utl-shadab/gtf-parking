import type { Level, Obstacle } from "../../types/game.ts";

// Placements checked with both car footprints and a driving route for each trial.
export const trafficLayouts: ReadonlyArray<{ lot: NonNullable<Level["lot"]>; extra: Obstacle[] }> = [
  { lot: {"width":27,"length":21.6}, extra: [
    {x: -2.4,z: -0.5,kind: "barrier",yaw: 0},
    {x: -2.4,z: 4.45,kind: "barrier",yaw: 0}
  ] },
  { lot: {"width":27,"length":21.6}, extra: [
    {x: 8.25,z: 0.5,kind: "car",yaw: 1.5707963267948966,style: "sedan",color: "#c55a43"},
    {x: 5.6,z: -1.6,kind: "barrier",yaw: 0},
    {x: 2.4,z: -1.05,kind: "barrier",yaw: 0},
    {x: 2.4,z: 2.25,kind: "barrier",yaw: 0}
  ] },
  { lot: {"width":27,"length":21.6}, extra: [
    {x: 4.15,z: -6.7,kind: "car",yaw: 0,style: "sedan",color: "#c55a43"},
    {x: -8,z: -3,kind: "car",yaw: 1.5707963267948966,style: "utility",color: "#9daab9"},
    {x: -8,z: 2.25,kind: "barrier",yaw: 1.5707963267948966}
  ] },
  { lot: {"width":29,"length":21.6}, extra: [
    {x: -12.25,z: 0.5,kind: "car",yaw: 1.5707963267948966,style: "hatch",color: "#406253"},
    {x: 4,z: 4,kind: "car",yaw: 1.5707963267948966,style: "sedan",color: "#c55a43"},
    {x: -2.5,z: 4,kind: "car",yaw: 1.5707963267948966,style: "utility",color: "#9daab9"},
    {x: 4,z: -3,kind: "car",yaw: 1.5707963267948966,style: "hatch",color: "#214c6b"},
    {x: -1,z: 2.8,kind: "barrier",yaw: 1.5707963267948966},
    {x: 7.8,z: -0.5,kind: "barrier",yaw: 1.5707963267948966},
    {x: 1.4,z: 2.8,kind: "barrier",yaw: 1.5707963267948966}
  ] },
  { lot: {"width":31,"length":21.6}, extra: [
    {x: 4.15,z: -6.7,kind: "car",yaw: 3.141592653589793,style: "hatch",color: "#406253"},
    {x: 6.25,z: 4,kind: "car",yaw: 1.5707963267948966,style: "sedan",color: "#c55a43"},
    {x: -0.25,z: 4,kind: "car",yaw: 1.5707963267948966,style: "utility",color: "#9daab9"},
    {x: -3.5,z: -3,kind: "car",yaw: 1.5707963267948966,style: "hatch",color: "#214c6b"},
    {x: -3.5,z: 0.5,kind: "car",yaw: 1.5707963267948966,style: "sedan",color: "#bd8d50"},
    {x: 8.4,z: 2.25,kind: "barrier",yaw: 1.5707963267948966},
    {x: 6.8,z: 2.8,kind: "barrier",yaw: 1.5707963267948966},
    {x: 4.4,z: 2.8,kind: "barrier",yaw: 1.5707963267948966},
    {x: 8.4,z: -0.5,kind: "barrier",yaw: 1.5707963267948966}
  ] },
  { lot: {"width":33,"length":22.5}, extra: [
    {x: -11,z: 0.5,kind: "car",yaw: 1.5707963267948966,style: "sedan",color: "#c55a43"},
    {x: 8.5,z: 4,kind: "car",yaw: 1.5707963267948966,style: "utility",color: "#9daab9"},
    {x: 11.75,z: -3,kind: "car",yaw: 1.5707963267948966,style: "hatch",color: "#214c6b"},
    {x: 5.25,z: -3,kind: "car",yaw: 1.5707963267948966,style: "sedan",color: "#bd8d50"},
    {x: -1.39,z: 6.9,kind: "car",yaw: 0,style: "utility",color: "#406253"},
    {x: 1,z: 4.55,kind: "barrier",yaw: 1.5707963267948966},
    {x: -2.2,z: 4.55,kind: "barrier",yaw: 1.5707963267948966},
    {x: -5.4,z: 4.55,kind: "barrier",yaw: 1.5707963267948966}
  ] },
  { lot: {"width":35,"length":23.400000000000002}, extra: [
    {x: 4.25,z: 4,kind: "car",yaw: 1.5707963267948966,style: "hatch",color: "#214c6b"},
    {x: -4.16,z: -6.7,kind: "car",yaw: 3.141592653589793,style: "sedan",color: "#bd8d50"},
    {x: -5.5,z: 0.5,kind: "car",yaw: 1.5707963267948966,style: "utility",color: "#406253"},
    {x: 4.15,z: -6.7,kind: "car",yaw: 3.141592653589793,style: "hatch",color: "#c55a43"},
    {x: 2.4,z: 1.35,kind: "barrier",yaw: 1.5707963267948966},
    {x: 4.8,z: 1.35,kind: "barrier",yaw: 1.5707963267948966},
    {x: 4,z: 1.9,kind: "barrier",yaw: 1.5707963267948966},
    {x: 1.6,z: -4.15,kind: "barrier",yaw: 1.5707963267948966},
    {x: -0.8,z: -0.3,kind: "barrier",yaw: 1.5707963267948966},
    {x: 0,z: 0.8,kind: "barrier",yaw: 1.5707963267948966},
    {x: -3.2,z: -0.85,kind: "barrier",yaw: 1.5707963267948966}
  ] },
  { lot: {"width":37,"length":24.3}, extra: [
    {x: -3.25,z: 4,kind: "car",yaw: 1.5707963267948966,style: "hatch",color: "#406253"},
    {x: 4.15,z: 6.9,kind: "car",yaw: 0,style: "sedan",color: "#c55a43"},
    {x: 4.15,z: -6.7,kind: "car",yaw: 3.141592653589793,style: "utility",color: "#9daab9"},
    {x: 3.25,z: 4,kind: "car",yaw: 1.5707963267948966,style: "hatch",color: "#214c6b"},
    {x: -4.16,z: 6.9,kind: "car",yaw: 3.141592653589793,style: "sedan",color: "#bd8d50"},
    {x: -12.47,z: 6.9,kind: "car",yaw: 0,style: "utility",color: "#406253"},
    {x: -9.75,z: -3,kind: "car",yaw: 1.5707963267948966,style: "hatch",color: "#c55a43"},
    {x: 12.46,z: -6.7,kind: "car",yaw: 0,style: "sedan",color: "#9daab9"},
    {x: 4.6,z: -0.2,kind: "barrier",yaw: 1.5707963267948966},
    {x: 5.4,z: -6.8,kind: "barrier",yaw: 0},
    {x: -9.8,z: 0.35,kind: "barrier",yaw: 1.5707963267948966},
    {x: -1,z: -3.5,kind: "barrier",yaw: 1.5707963267948966}
  ] },
  { lot: {"width":39,"length":25.200000000000003}, extra: [
    {x: 4.15,z: 6.9,kind: "car",yaw: 0,style: "sedan",color: "#c55a43"},
    {x: 8.75,z: 4,kind: "car",yaw: 1.5707963267948966,style: "utility",color: "#9daab9"},
    {x: 8.75,z: -3,kind: "car",yaw: 1.5707963267948966,style: "hatch",color: "#214c6b"},
    {x: -4.16,z: -6.7,kind: "car",yaw: 3.141592653589793,style: "sedan",color: "#bd8d50"},
    {x: 4.15,z: -6.7,kind: "car",yaw: 0,style: "utility",color: "#406253"},
    {x: -12.47,z: 6.9,kind: "car",yaw: 3.141592653589793,style: "hatch",color: "#c55a43"},
    {x: -14,z: 4,kind: "car",yaw: 1.5707963267948966,style: "sedan",color: "#9daab9"},
    {x: 6.92,z: -6.7,kind: "car",yaw: 3.141592653589793,style: "utility",color: "#214c6b"},
    {x: -6.8,z: 2.1,kind: "barrier",yaw: 1.5707963267948966},
    {x: -0.4,z: 2.1,kind: "barrier",yaw: 1.5707963267948966}
  ] },
  { lot: {"width":41,"length":26.1}, extra: [
    {x: -5.25,z: 0.5,kind: "car",yaw: 1.5707963267948966,style: "sedan",color: "#c55a43"},
    {x: 4.15,z: 6.9,kind: "car",yaw: 3.141592653589793,style: "utility",color: "#9daab9"},
    {x: -11.75,z: 0.5,kind: "car",yaw: 1.5707963267948966,style: "hatch",color: "#214c6b"},
    {x: 14.25,z: 0.5,kind: "car",yaw: 1.5707963267948966,style: "sedan",color: "#bd8d50"},
    {x: 14.25,z: 4,kind: "car",yaw: 1.5707963267948966,style: "utility",color: "#406253"},
    {x: -12.47,z: -6.7,kind: "car",yaw: 3.141592653589793,style: "hatch",color: "#c55a43"},
    {x: -15,z: -3,kind: "car",yaw: 1.5707963267948966,style: "sedan",color: "#9daab9"},
    {x: 11,z: -3,kind: "car",yaw: 1.5707963267948966,style: "utility",color: "#214c6b"},
    {x: 12.46,z: 6.9,kind: "car",yaw: 0,style: "hatch",color: "#bd8d50"},
    {x: -7.8,z: -1.1,kind: "barrier",yaw: 1.5707963267948966},
    {x: -3.8,z: -3.85,kind: "barrier",yaw: 1.5707963267948966},
    {x: -11,z: -4.4,kind: "barrier",yaw: 1.5707963267948966},
    {x: -1.4,z: -3.85,kind: "barrier",yaw: 1.5707963267948966}
  ] }
];
