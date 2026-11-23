/**
 * WARLORD RAGE aura: a translucent purple shell around DREADNOUGHT's whole silhouette.
 *
 * One extra skinned mesh per skinned mesh of his model, sharing its geometry AND skeleton (no extra
 * memory, it follows every animation exactly), pushed out along the normals by `inflate` (model
 * units) and drawn additively with a fresnel rim (gold at the edges, violet inside) and slow energy
 * bands rising up the body. Hidden (no draw call) unless raging; his own materials are untouched.
 */
import * as THREE from 'three';

const vertexShader = `
  #include <common>
  #include <skinning_pars_vertex>
  uniform float uInflate;
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    transformed += normalize(objectNormal) * uInflate;
    vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
    vN = normalize(normalMatrix * objectNormal);
    vV = normalize(-mv.xyz);
    vY = position.y;
    gl_Position = projectionMatrix * mv;
  }`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform vec3 uRim;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    // a rim of light around his silhouette (gold at the very edge), barely anything over his body,
    // so the model itself stays clearly visible; slow bands of energy rise through it
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float rim = pow(f, 2.4);
    float bands = 0.55 + 0.45 * sin(vY * 8.0 - uTime * 4.5);
    vec3 col = mix(uColor, uRim, rim * rim * 0.8);
    float a = (0.035 + 0.75 * rim) * bands * uOpacity;
    gl_FragColor = vec4(col, a);
  }`;

/**
 * @param {{model:THREE.Object3D}} inst a fighter instance (buildCharacterInstance)
 * @param {{color:number, rim:number, inflate:number, opacity:number}} cfg CONFIG.dreadnought.rage.aura
 * @returns {{meshes:THREE.SkinnedMesh[], material:THREE.ShaderMaterial, set:(w:number, t:number)=>void, dispose:()=>void}}
 */
export function createRageAura(inst, cfg) {
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      uColor: { value: new THREE.Color(cfg.color) }, uRim: { value: new THREE.Color(cfg.rim) },
      uOpacity: { value: 0 }, uTime: { value: 0 }, uInflate: { value: cfg.inflate },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const sources = [];
  inst.model.traverse((o) => { if (o.isSkinnedMesh) sources.push(o); });
  const meshes = sources.map((m) => {
    const a = new THREE.SkinnedMesh(m.geometry, material);
    a.bind(m.skeleton, m.bindMatrix);
    a.position.copy(m.position); a.quaternion.copy(m.quaternion); a.scale.copy(m.scale);
    a.frustumCulled = false;
    a.renderOrder = 2;
    a.visible = false;
    a.name = 'rageAura';
    m.parent.add(a);
    return a;
  });
  return {
    meshes, material,
    /** Visibility 0..1 and the animation time (s). */
    set(w, t) {
      material.uniforms.uOpacity.value = w * cfg.opacity;
      material.uniforms.uTime.value = t;
      for (const a of meshes) a.visible = w > 0.01;
    },
    dispose() {
      for (const a of meshes) a.removeFromParent();
      material.dispose();
    },
  };
}
