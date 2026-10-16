// 3D preview (SPEC 6.2): the mesh in grey, the recognised cylinders in
// colour, switchable between input and result. three.js is loaded on demand,
// like in MusterGenerator/js/ui/view3d.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { featureColor } from './report.js';

/** Vertex colours per view, so switching costs no new geometry. */
const GREY = [0.76, 0.78, 0.82];

export class Preview {
  constructor(container) {
    this.container = container;
    this.mode = 'ergebnis';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    // render() must not call controls.update(): update() fires 'change', and
    // the listener would call render() again (endless recursion). The damping
    // runs in its own frame loop instead, as in MusterGenerator's view.
    this.controls.addEventListener('change', () => this.render());
    this.frame = 0;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4050, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(-0.6, 1.4, 0.8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
    fill.position.set(0.9, 0.5, -0.7);
    this.scene.add(fill);

    this.group = new THREE.Group();
    this.group.rotation.x = -Math.PI / 2; // CAD is Z-up, three.js is Y-up
    this.scene.add(this.group);
    this.mesh = null;
    this.edges = null;
    this.updateTheme();
    window.addEventListener('resize', () => this.resize());
  }

  updateTheme() {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--stage-bg').trim() || '#131519';
    this.scene.background = new THREE.Color(bg);
    this.render();
  }

  /** preview: { V, F, cylinderOfTriangle } from the worker. */
  show(preview) {
    this.preview = preview;
    this.clear();
    const count = preview.F.length;
    const positions = new Float32Array(3 * count);
    const colors = new Float32Array(3 * count);
    for (let i = 0; i < count; i++) {
      const v = 3 * preview.F[i];
      positions[3 * i] = preview.V[v];
      positions[3 * i + 1] = preview.V[v + 1];
      positions[3 * i + 2] = preview.V[v + 2];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true, metalness: 0.12, roughness: 0.52, flatShading: true,
    }));
    this.group.add(this.mesh);
    this.edges = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12 }),
    );
    this.group.add(this.edges);
    this.applyMode();
    this.resetCamera();
    if (!this.frame) this.loop();
  }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    this.mesh = null;
    this.edges = null;
  }

  setMode(mode) {
    this.mode = mode;
    this.applyMode();
  }

  /** Grey for the input, one colour per cylinder for the result. */
  applyMode() {
    if (!this.mesh || !this.preview) return;
    const { F, cylinderOfTriangle } = this.preview;
    const colors = this.geometry.getAttribute('color');
    const palette = new Map();
    for (let t = 0; t < F.length / 3; t++) {
      const id = this.mode === 'eingabe' ? -1 : cylinderOfTriangle[t];
      let rgb = GREY;
      if (id >= 0) {
        if (!palette.has(id)) palette.set(id, cssToRgb(featureColor(id)));
        rgb = palette.get(id);
      }
      for (let k = 0; k < 3; k++) colors.setXYZ(3 * t + k, rgb[0], rgb[1], rgb[2]);
    }
    colors.needsUpdate = true;
    if (this.edges) this.edges.visible = this.mode === 'eingabe';
    this.render();
  }

  resetCamera() {
    const sphere = this.geometry?.boundingSphere;
    if (!sphere) return;
    const r = Math.max(sphere.radius, 1);
    const center = sphere.center;
    this.controls.target.set(center.x, center.z, -center.y); // the group is rotated
    const d = r * 3.2;
    this.camera.position.set(center.x + d * 0.6, center.z + d * 0.55, -center.y + d * 0.7);
    this.camera.near = r / 100;
    this.camera.far = r * 100;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || 640;
    const h = this.container.clientHeight || 420;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Frame loop for the damping of the orbit controls. */
  loop() {
    this.controls.update();
    this.frame = requestAnimationFrame(() => this.loop());
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}

/** hsl(…) from report.js → linear-ish rgb for three.js vertex colours. */
function cssToRgb(css) {
  const m = /hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\)/.exec(css);
  if (!m) return GREY;
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => v ** 2.2);
}
