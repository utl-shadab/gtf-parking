import * as THREE from "three";
import type { Pose } from "@/types/game";

const textureSets = [
  ["brick", 0.48], ["roof", 0.57], ["rock", 0.21], ["sand", 0.42],
] as const;
type Surface = typeof textureSets[number][0] | "grass" | "stone";
type CitySurface = { color: THREE.Texture; normal?: THREE.Texture };

let textureRequest: ReturnType<typeof requestTextures> | undefined;

async function requestTextures() {
  const loader = new THREE.TextureLoader();
  async function tiled(path: string, repeat: number, srgb: boolean) {
    const texture = await loader.loadAsync(path);
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.setScalar(repeat);
    texture.anisotropy = 4;
    return texture;
  }
  const entries = await Promise.all(textureSets.map(async ([name, scale]) => {
    const [color, normal] = await Promise.all([
      tiled(`/surfaces/city/${name}-color.webp`, scale, true),
      tiled(`/surfaces/city/${name}-normal.webp`, scale, false),
    ]);
    return [name, { color, normal }] as const;
  }));
  const [grass, stone] = await Promise.all([
    tiled("/surfaces/grass.webp", 0.33, true), tiled("/surfaces/stone.webp", 0.65, true),
  ]);
  return new Map<Surface, CitySurface>([...entries, ["grass", { color: grass }], ["stone", { color: stone }]]);
}

export function loadCityTextures() {
  return textureRequest ??= requestTextures().catch((error: unknown) => {
    textureRequest = undefined;
    throw error;
  });
}

const surfaces: Partial<Record<string, [Surface, number]>> = {
  Brick: ["brick", 0xe5e0d7], "Roof slate": ["roof", 0xd4d0c9], "Ridge rock": ["rock", 0xbeb3a1],
  "Ridge grass": ["grass", 0xc6c5ae], Lawn: ["grass", 0xb3c29c], Sand: ["sand", 0xe7d7b8], "Wet sand": ["sand", 0xae9c83],
  Pavers: ["stone", 0xd7cbc0], Meadow: ["grass", 0xb5c39d],
};

export function fitCityMaterial(material: THREE.MeshStandardMaterial, textures: Map<Surface, CitySurface>) {
  const surface = surfaces[material.name];
  if (!surface) return;
  const [name, tint] = surface;
  const set = textures.get(name);
  if (!set) return;
  material.color.set(tint);
  material.map = set.color;
  if (material.name === "Pavers" || material.name === "Meadow") {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", `
        #include <uv_vertex>
        vec3 pavingPoint = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 pavingNormal = abs(normalize(mat3(modelMatrix) * normal));
        vec2 pavingUV = pavingNormal.y > 0.65 ? pavingPoint.xz :
          pavingNormal.x > pavingNormal.z ? pavingPoint.zy : pavingPoint.xy;
        vMapUv = (mapTransform * vec3(pavingUV, 1.0)).xy;
      `);
    };
  }
  if (set.normal) {
    material.normalMap = set.normal;
    material.normalScale.setScalar(name === "rock" ? 0.6 : 0.39);
  }
}

export function addSeaWaves(material: THREE.MeshStandardMaterial, time: { value: number }, sky: THREE.Color) {
  material.roughness = material.name === "Sea" ? 0.34 : 0.41;
  material.envMapIntensity = 0.22;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.breakerClock = time;
    shader.uniforms.seaSky = { value: sky };
    shader.vertexShader = "varying vec3 shorePoint;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nshorePoint = (modelMatrix * vec4(position, 1.0)).xyz;",
    );
    shader.fragmentShader = "varying vec3 shorePoint;\nuniform float breakerClock;\nuniform vec3 seaSky;\n" +
      shader.fragmentShader.replace("#include <color_fragment>", `
        #include <color_fragment>
        vec2 water = shorePoint.xz;
        float swell = sin(water.x * 0.25 + water.y * 0.17 + breakerClock * 0.42);
        float ebb = sin(water.y * 1.64 + 1.8 * swell - breakerClock * 1.9);
        float windRipples = 0.58 * sin(dot(water, vec2(1.21, 0.82)) - breakerClock * 2.7)
                          + 0.42 * sin(dot(water, vec2(-1.86, 0.38)) + breakerClock * 2.1);
        float shore = 1.0 - smoothstep(129.0, 151.0, shorePoint.z);
        float viewGlance = 1.0 - abs(normalize(cameraPosition - shorePoint).y);
        float streak = smoothstep(0.84, 0.99, ebb * 0.78 + windRipples * 0.22) * shore;
        vec3 waterTone = mix(vec3(0.012, 0.09, 0.17), vec3(0.035, 0.26, 0.24), shore);
        waterTone = mix(waterTone, seaSky * 0.76, pow(viewGlance, 4.0) * 0.58);
        diffuseColor.rgb = mix(waterTone * (0.96 + windRipples * 0.10), vec3(0.68, 0.82, 0.78), streak * 0.38);
      `).replace("#include <normal_fragment_maps>", `
        #include <normal_fragment_maps>
        vec2 slope = vec2(windRipples * 0.076 + cos(shorePoint.x * 2.3 + breakerClock) * 0.043,
                          ebb * 0.052 + windRipples * 0.068);
        normal = normalize(normal + (viewMatrix * vec4(slope.x, 0.0, slope.y, 0.0)).xyz);
      `);
  };
}

type TreeSite = {
  position: THREE.Vector3;
  transform: THREE.Matrix4;
  instances: { mesh: THREE.InstancedMesh; index: number; original: THREE.Matrix4 }[];
};

export function createCityTrees(scene: THREE.Scene, map: THREE.Object3D, streetTree: THREE.Group) {
  const sites = new Map<string, TreeSite>();
  map.traverse((object) => {
    if (!(object instanceof THREE.InstancedMesh) || Array.isArray(object.material)
      || !/^(Bark|Pine green|Olive foliage|Leaf green)$/.test(object.material.name)) return;
    for (let index = 0; index < object.count; index++) {
      const original = new THREE.Matrix4();
      object.getMatrixAt(index, original);
      const transform = object.matrixWorld.clone().multiply(original);
      const position = new THREE.Vector3().setFromMatrixPosition(transform);
      const key = position.toArray().map((coordinate) => coordinate.toFixed(3)).join(",");
      const site = sites.get(key) ?? { position, transform, instances: [] };
      site.instances.push({ mesh: object, index, original });
      sites.set(key, site);
    }
  });
  streetTree.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(streetTree, true);
  const base = box.getCenter(new THREE.Vector3());
  const scale = 4.75 / (box.max.y - box.min.y);
  const fitted = new THREE.Matrix4().makeTranslation(-base.x, -box.min.y, -base.z)
    .premultiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  const batches: { mesh: THREE.InstancedMesh; offset: THREE.Matrix4 }[] = [];
  streetTree.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, 16);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    scene.add(mesh);
    batches.push({ mesh, offset: fitted.clone().multiply(part.matrixWorld) });
  });
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const transform = new THREE.Matrix4();
  let previous = new Set<TreeSite>();
  return {
    update(pose: Pose, limit: number) {
      const nearby = [...sites.values()].map((site) => ({ site, distance: (site.position.x - pose.x) ** 2 + (site.position.z - pose.z) ** 2 }))
        .filter(({ distance }) => distance < 43 ** 2).sort((a, b) => a.distance - b.distance).slice(0, limit).map(({ site }) => site);
      const next = new Set(nearby);
      if (next.size === previous.size && nearby.every((site) => previous.has(site))) return;
      for (const site of new Set([...next, ...previous])) {
        for (const { mesh, index, original } of site.instances) {
          mesh.setMatrixAt(index, next.has(site) ? hidden : original);
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
      for (const { mesh, offset } of batches) {
        nearby.forEach((site, index) => mesh.setMatrixAt(index, transform.multiplyMatrices(site.transform, offset)));
        mesh.count = nearby.length;
        mesh.instanceMatrix.needsUpdate = true;
      }
      previous = next;
    },
    dispose() {
      for (const { mesh } of batches) {
        mesh.removeFromParent();
        mesh.dispose();
      }
    },
  };
}
