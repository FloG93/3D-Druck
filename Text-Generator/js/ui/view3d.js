// 3D preview of the parts in their colours (three.js, loaded on demand).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { modelMeshes } from '../export/mesh.js';

const de = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });

export class View3D {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.visible = false;
    this.timer = 0;
    this.frame = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => this.render());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4050, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-0.6, 1.4, 0.8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.8);
    fill.position.set(0.9, 0.5, -0.7);
    this.scene.add(fill);
    // From below, so magnet pockets and countersinks show on the back.
    const under = new THREE.DirectionalLight(0xffffff, 1.4);
    under.position.set(0.25, -1, 0.35);
    this.scene.add(under);

    this.group = new THREE.Group();
    // CAD is Z-up, three.js is Y-up.
    this.group.rotation.x = -Math.PI / 2;
    this.scene.add(this.group);
    this.info = document.createElement('div');
    this.info.className = 'hint';
    container.append(this.info);

    this.updateTheme();
    this.rebuild();
  }

  updateTheme() {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--stage-bg').trim() || '#131519';
    this.scene.background = new THREE.Color(bg);
    this.render();
  }

  update() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.rebuild(), 120);
  }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.geometry.dispose();
      child.material.dispose();
    }
  }

  rebuild() {
    const { model } = this.app;
    if (!model) return;
    this.clear();
    let triangles = 0;
    for (const m of modelMeshes(model)) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(m.positions.slice(), 3));
      geom.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: m.part.color, metalness: 0.05, roughness: 0.6, flatShading: true });
      this.group.add(new THREE.Mesh(geom, mat));
      triangles += m.triangles;
    }
    const s = model.stats;
    const parts = model.parts.map((p) => `${p.name} (Filament ${p.slot})`).join(' · ');
    this.info.innerHTML = `<b>3D</b> ${de(s.width)} × ${de(s.height)} × ${de(s.top)} mm · ${parts || 'leer'} · ${triangles.toLocaleString('de-DE')} Dreiecke · Ziehen: drehen · Rechtsklick-Ziehen: verschieben`;
    this.render();
  }

  resetCamera() {
    const { model } = this.app;
    // Everything: a stamp's handle stands beside the plate.
    const b = model && Number.isFinite(model.extent.minX) ? model.extent : { minX: -30, minY: -10, maxX: 30, maxY: 10, top: 3 };
    const W = b.maxX - b.minX;
    const H = b.maxY - b.minY;
    const { top } = b;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const size = Math.max(W, H, top, 1);
    const radius = Math.hypot(W, H, top) / 2;
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * (this.camera.aspect || 1));
    const dist = (radius / Math.sin(Math.min(vHalf, hHalf))) * 1.05;
    const elevation = (52 * Math.PI) / 180;
    const azimuth = (22 * Math.PI) / 180;
    const ground = dist * Math.cos(elevation);
    // World (x, y, z) -> three (x, z, -y).
    const target = new THREE.Vector3(cx, top / 2, -cy);
    this.camera.position.set(target.x + ground * Math.sin(azimuth), target.y + dist * Math.sin(elevation), target.z + ground * Math.cos(azimuth));
    this.controls.target.copy(target);
    this.camera.near = size / 200;
    this.camera.far = size * 50;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (!this.visible) return;
    this.renderer.render(this.scene, this.camera);
  }

  loop() {
    if (!this.visible) return;
    this.controls.update();
    this.frame = requestAnimationFrame(() => this.loop());
  }

  show() {
    const first = !this.shown;
    this.visible = true;
    this.shown = true;
    this.resize();
    this.rebuild();
    if (first) this.resetCamera();
    this.loop();
  }

  hide() {
    this.visible = false;
    cancelAnimationFrame(this.frame);
  }
}
