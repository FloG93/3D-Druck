// 3D preview of the perforated plate (three.js, loaded on demand).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildPlateMesh } from '../export/mesh.js';

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

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4050, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-0.6, 1.4, 0.8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.8);
    fill.position.set(0.9, 0.5, -0.7);
    this.scene.add(fill);

    this.material = new THREE.MeshStandardMaterial({ color: 0xc3c9d2, metalness: 0.15, roughness: 0.5 });
    this.group = new THREE.Group();
    // CAD is Z-up, three.js is Y-up.
    this.group.rotation.x = -Math.PI / 2;
    this.scene.add(this.group);
    this.mesh = null;
    this.info = document.createElement('div');
    this.info.className = 'hint';
    this.info.style.pointerEvents = 'none';
    container.append(this.info);

    this.updateTheme();
    this.rebuild();
    this.resetCamera();
  }

  updateTheme() {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--stage-bg').trim() || '#131519';
    this.scene.background = new THREE.Color(bg);
    this.render();
  }

  update() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.rebuild(), 150);
  }

  rebuild() {
    const { result, doc } = this.app;
    if (!result) return;
    const t = Math.max(doc.export.thickness || 2, 0.1);
    const tol = Math.max(0.02, Math.min(doc.canvas.width, doc.canvas.height) / 4000);
    const mesh = buildPlateMesh(result.boundary.outline, result.holes.map((h) => h.outline), t, tol, { watertight: false });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(mesh.positions.slice(), 3));
    geom.computeVertexNormals();
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.mesh = new THREE.Mesh(geom, this.material);
    this.group.add(this.mesh);
    this.info.innerHTML = `<b>3D</b> Plattendicke ${t.toLocaleString('de-DE')} mm (einstellbar im Export) · ${mesh.triangles.toLocaleString('de-DE')} Dreiecke · Ziehen: drehen · Rechtsklick-Ziehen: verschieben`;
    this.render();
  }

  resetCamera() {
    const { width: W, height: H } = this.app.doc.canvas;
    const size = Math.max(W, H);
    // Fit the bounding sphere of the plate into the narrower field of view.
    const radius = Math.hypot(W, H) / 2;
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * (this.camera.aspect || 1));
    const dist = (radius / Math.sin(Math.min(vHalf, hHalf))) * 1.02;
    const elevation = (48 * Math.PI) / 180;
    const azimuth = (32 * Math.PI) / 180;
    const ground = dist * Math.cos(elevation);
    this.camera.position.set(ground * Math.sin(azimuth), dist * Math.sin(elevation), ground * Math.cos(azimuth));
    this.controls.target.set(0, 0, 0);
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
    if (first) this.resetCamera();
    this.rebuild();
    this.loop();
  }

  hide() {
    this.visible = false;
    cancelAnimationFrame(this.frame);
  }
}
