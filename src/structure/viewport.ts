import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Design, Vec3 } from "./design";
import { femaleGeometry, femaleLayerSign, maleGeometry, memberFrame, ringGeometry } from "./geometry";
import { holeOccupied, holeSite } from "./holes";
import { detectRopeFrames, type RopeFrame, ropeAttachments } from "./rope";

export class Viewport {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  private controls: OrbitControls;
  private transform: TransformControls;
  private anchor = new THREE.Object3D();
  private group = new THREE.Group();
  private targets: THREE.Object3D[] = [];
  private current: Design | null = null;
  private editing = true;
  private move = false;
  onSelect: (id: string) => void = () => {};
  onMemberSelect: (id: string) => void = () => {};
  onRingSelect: (id: string) => void = () => {};
  onMoveNode: (id: string, position: Vec3) => void = () => {};
  private selectedNode = "";
  private choosingFrame = false;
  private selectedFrame = "";
  onFrameSelect: (id: string) => void = () => {};
  onHoleSelect: (female: string, hole: number) => void = () => {};
  private choosingHole = false;
  private chosenHole: { female: string; hole: number } | null = null;
  private preview: { start: Vec3; end: Vec3 } | null = null;
  private hovered = "";
  private pulseIds = new Set<string>();
  private pulseStart = 0;
  /** Temporarily emphasise a member, e.g. while its result row is hovered. */
  setHover(member: string) {
    this.hovered = member;
  }
  /** Short flash on members that just snapped into place or got a rope. */
  pulse(members: string[]) {
    this.pulseIds = new Set(members);
    this.pulseStart = performance.now();
  }
  private applyEmphasis(now: number) {
    const t = (now - this.pulseStart) / 420;
    const flash = t < 1 ? (1 - t) ** 2 : 0;
    if (flash === 0 && this.pulseIds.size) this.pulseIds.clear();
    for (const target of this.targets) {
      const member = target.userData.member;
      if (!member || !(target instanceof THREE.Mesh)) continue;
      const material = target.material;
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const intensity = Math.max(this.pulseIds.has(member) ? flash : 0, member === this.hovered ? 0.35 : 0);
      material.emissive.setHex(0xffb347);
      material.emissiveIntensity = intensity;
    }
  }
  setHoleSelection(
    choosing: boolean,
    chosen: { female: string; hole: number } | null,
    preview: { start: Vec3; end: Vec3 } | null,
  ) {
    this.choosingHole = choosing;
    this.chosenHole = chosen;
    this.preview = preview;
  }
  setFrameSelection(choosing: boolean, id: string) {
    this.choosingFrame = choosing;
    this.selectedFrame = id;
  }
  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor("#edf1e8");
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D設計。ドラッグで視点回転。部材・節点をクリックして選択。移動モードでは矢印で節点を動かせます。",
    );
    this.renderer.domElement.setAttribute("role", "img");
    this.host.append(this.renderer.domElement);
    this.camera.position.set(3.6, 2.8, 3.8);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0.7, 0.6, 0.5);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x62745a, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 6, 4);
    this.scene.add(light);
    const grid = new THREE.GridHelper(12, 48, 0x9bad97, 0xd3ddcc);
    grid.position.y = -0.3;
    this.scene.add(grid);
    this.scene.add(this.group);
    this.scene.add(this.anchor);
    const axes = new THREE.AxesHelper(0.65);
    axes.position.set(-0.4, -0.28, -0.4);
    this.scene.add(axes);
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode("translate");
    this.transform.setTranslationSnap(0.05);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener("dragging-changed", (event) => {
      this.controls.enabled = !event.value;
    });
    this.transform.addEventListener("mouseUp", () => {
      if (this.selectedNode) this.onMoveNode(this.selectedNode, this.anchor.position.toArray() as Vec3);
    });
    let sx = 0;
    let sy = 0;
    let dragged = false;
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      sx = e.clientX;
      sy = e.clientY;
      dragged = this.transform.dragging;
    });
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      if (
        dragged ||
        this.transform.dragging ||
        Math.hypot(e.clientX - sx, e.clientY - sy) > 5 ||
        this.transform.axis
      )
        return;
      const r = this.renderer.domElement.getBoundingClientRect();
      const point = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(point, this.camera);
      const hit = ray.intersectObjects(
        this.choosingHole
          ? this.targets.filter((o) => o.userData.hole !== undefined)
          : this.choosingFrame
            ? this.targets.filter((o) => o.userData.frame)
            : this.targets.filter((o) => !o.userData.frame && o.userData.hole === undefined),
      )[0];
      if (!hit) return;
      if (hit.object.userData.hole !== undefined)
        this.onHoleSelect(String(hit.object.userData.female), Number(hit.object.userData.hole));
      else if (hit.object.userData.frame) this.onFrameSelect(String(hit.object.userData.frame));
      else if (hit.object.userData.node) this.onSelect(String(hit.object.userData.node));
      else if (hit.object.userData.member) this.onMemberSelect(String(hit.object.userData.member));
      else if (hit.object.userData.ring) this.onRingSelect(String(hit.object.userData.ring));
    });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.applyEmphasis(performance.now());
      this.renderer.render(this.scene, this.camera);
    });
  }
  setTools(editing: boolean, move: boolean, snap: number) {
    this.editing = editing;
    this.move = move;
    this.transform.setTranslationSnap(snap);
    if (!editing || !move) this.transform.detach();
  }
  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }
  private clear() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose();
      }
    });
    this.group.clear();
    this.targets = [];
  }
  private mesh(
    geometry: THREE.BufferGeometry,
    color: number,
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    tag: { member?: string; ring?: string },
    highlight: boolean,
  ) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    mesh.position.copy(position);
    mesh.quaternion.copy(rotation);
    mesh.userData = tag;
    this.group.add(mesh);
    this.targets.push(mesh);
    if (highlight) {
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0xf3912d }),
      );
      outline.position.copy(position);
      outline.quaternion.copy(rotation);
      this.group.add(outline);
    }
    return mesh;
  }
  private line(a: THREE.Vector3, b: THREE.Vector3, color: number, width: number) {
    const delta = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(width, width, delta.length(), 6);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    this.group.add(mesh);
  }
  show(
    design: Design,
    displacement: number[] | null = null,
    scale = 1,
    selected = "",
    ropeMode = "taut",
    labels = true,
  ) {
    this.current = design;
    this.clear();
    const points = new Map<string, THREE.Vector3>();
    design.nodes.forEach((node, i) => {
      const p = new THREE.Vector3(...node.position);
      if (displacement)
        p.add(new THREE.Vector3(...(displacement.slice(i * 6, i * 6 + 3) as Vec3)).multiplyScalar(scale));
      points.set(node.id, p);
    });
    for (const member of design.members) {
      const a = points.get(member.start);
      const b = points.get(member.end);
      if (!a || !b) continue;
      const frame = memberFrame(a, b, member.roll);
      const length = a.distanceTo(b);
      const highlight = selected === `member:${member.id}`;
      if (member.kind === "male")
        for (const [i, g] of maleGeometry(length, design.geometry).entries())
          this.mesh(g, i === 0 ? 0xa47546 : 0x85623f, a, frame.quaternion, { member: member.id }, highlight);
      else {
        const shift = frame.z
          .clone()
          .multiplyScalar(
            femaleLayerSign(design, member, frame.z) * (member.layer + 0.5) * design.geometry.thickness,
          );
        this.mesh(
          femaleGeometry(length, design.geometry, member.holeCount),
          0xd9bb85,
          a.clone().add(shift),
          frame.quaternion,
          { member: member.id },
          highlight,
        );
      }
    }
    if (ropeMode !== "none")
      for (const rope of design.ropes) {
        const attachments = ropeAttachments(design, rope);
        const ropePoints = attachments.map((attachment) => {
          const point = new THREE.Vector3(...attachment.position);
          if (displacement) {
            const i = design.nodes.findIndex((n) => n.id === attachment.node) * 6;
            const translation = new THREE.Vector3(...(displacement.slice(i, i + 3) as Vec3));
            const rotation = new THREE.Vector3(...(displacement.slice(i + 3, i + 6) as Vec3));
            point
              .addScaledVector(translation, scale)
              .addScaledVector(rotation.cross(new THREE.Vector3(...attachment.offset)), scale);
          }
          return point;
        });
        for (let s = 0; s < 3; s++)
          this.line(ropePoints[s], ropePoints[s + 1], ropeMode === "slack" ? 0xb1a18c : 0xc95732, 0.006);
      }
    for (const frame of detectRopeFrames(design))
      if (this.choosingFrame || frame.id === this.selectedFrame)
        this.frameOverlay(frame, points, frame.id === this.selectedFrame);
    for (const member of design.members.filter((m) => m.kind === "female"))
      for (let hole = 0; hole < member.holeCount; hole++) {
        const chosen = this.chosenHole?.female === member.id && this.chosenHole.hole === hole;
        if ((!this.choosingHole && !chosen) || holeOccupied(design, member.id, hole)) continue;
        const site = holeSite(design, member.id, hole);
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(chosen ? 0.032 : 0.022, 10, 8),
          new THREE.MeshBasicMaterial({
            color: chosen ? 0xf4aa34 : 0x269d77,
            transparent: true,
            opacity: 0.75,
            depthTest: false,
          }),
        );
        marker.position.set(...site.position);
        marker.userData = { hole, female: member.id };
        marker.renderOrder = 5;
        this.group.add(marker);
        this.targets.push(marker);
      }
    if (this.preview) {
      const a = new THREE.Vector3(...this.preview.start);
      const b = new THREE.Vector3(...this.preview.end);
      const basis = memberFrame(a, b, 0);
      for (const geometry of maleGeometry(a.distanceTo(b), design.geometry)) {
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: 0x3d9d86,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
          }),
        );
        mesh.position.copy(a);
        mesh.quaternion.copy(basis.quaternion);
        this.group.add(mesh);
      }
    }
    for (const node of design.nodes) {
      const point = points.get(node.id);
      if (!point) continue;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(selected === node.id ? 0.045 : 0.024, 12, 8),
        new THREE.MeshStandardMaterial({
          color: selected === node.id ? 0xf1a043 : node.fixed ? 0x275d4d : 0xeee6d0,
          transparent: true,
          opacity: labels ? 0.9 : 0,
        }),
      );
      mesh.position.copy(point);
      mesh.userData.node = node.id;
      this.targets.unshift(mesh);
      this.group.add(mesh);
      if (node.fixed) {
        const support = new THREE.Mesh(
          new THREE.BoxGeometry(0.11, 0.025, 0.11),
          new THREE.MeshStandardMaterial({ color: 0x506e5a }),
        );
        support.position.copy(point).add(new THREE.Vector3(0, -0.13, 0));
        this.group.add(support);
      }
    }
    for (const ring of design.rings) {
      const host = design.members.find((m) => m.id === ring.member);
      if (!host) continue;
      const a = points.get(host.start);
      const b = points.get(host.end);
      if (!a || !b) continue;
      const frame = memberFrame(a, b, host.roll);
      const p = (ring.end === "start" ? a : b)
        .clone()
        .addScaledVector(
          frame.x,
          (ring.end === "start" ? -1 : 1) * (ring.slot + 0.5) * design.geometry.thickness,
        );
      this.mesh(
        ringGeometry(design.geometry),
        0xc59b60,
        p,
        frame.quaternion,
        { ring: ring.id },
        selected === `ring:${ring.id}`,
      );
    }
    if (displacement)
      for (const m of design.members) {
        const a = design.nodes.find((n) => n.id === m.start);
        const b = design.nodes.find((n) => n.id === m.end);
        if (a && b) {
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(...a.position),
              new THREE.Vector3(...b.position),
            ]),
            new THREE.LineBasicMaterial({ color: 0x60755e, transparent: true, opacity: 0.25 }),
          );
          this.group.add(line);
        }
      }
    this.selectedNode = design.nodes.some((n) => n.id === selected) ? selected : "";
    const selectedPoint = points.get(this.selectedNode);
    if (this.editing && this.move && selectedPoint) {
      this.anchor.position.copy(selectedPoint);
      this.transform.attach(this.anchor);
    } else this.transform.detach();
  }
  private frameOverlay(frame: RopeFrame, points: Map<string, THREE.Vector3>, selected: boolean) {
    const p = frame.nodes.map((id) => points.get(id));
    if (p.some((v) => !v)) return;
    const vertices = [0, 1, 2, 0, 2, 3].flatMap((i) => (p[i] as THREE.Vector3).toArray());
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: selected ? 0xeaa140 : 0x39795c,
        transparent: true,
        opacity: selected ? 0.22 : 0.13,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.userData.frame = frame.id;
    this.group.add(mesh);
    this.targets.push(mesh);
  }
  fit() {
    if (!this.current) return;
    const box = new THREE.Box3();
    for (const n of this.current.nodes) box.expandByPoint(new THREE.Vector3(...n.position));
    box.expandByScalar(this.current.geometry.tenonLength);
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(1, 0.65, 1).multiplyScalar(size));
    this.controls.update();
  }
  viewTop() {
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(0.001, 5, 0));
    this.controls.update();
  }
  viewFront() {
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(0, 0.1, 5));
    this.controls.update();
  }
  viewSide() {
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(5, 0.1, 0));
    this.controls.update();
  }
  focusMember(id: string) {
    if (!this.current) return;
    const m = this.current.members.find((m) => m.id === id);
    if (!m) return;
    const a = this.current.nodes.find((n) => n.id === m.start);
    const b = this.current.nodes.find((n) => n.id === m.end);
    if (!a || !b) return;
    const center = new THREE.Vector3(...a.position).add(new THREE.Vector3(...b.position)).multiplyScalar(0.5);
    const distance = Math.max(
      new THREE.Vector3(...a.position).distanceTo(new THREE.Vector3(...b.position)) * 1.5,
      0.8,
    );
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0.7, 0.5, 1).multiplyScalar(distance));
    this.controls.update();
  }
}
