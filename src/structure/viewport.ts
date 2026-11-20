import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Design, Vec3 } from "./design";
import type { EngineeringResult } from "./engineering";
import { femaleGeometry, femaleLayerSign, maleGeometry, memberFrame, ringGeometry } from "./geometry";
import { holeOccupied, holeSite } from "./holes";
import { detectRopeFrames, type RopeFrame, ropeAttachments } from "./rope";

/** What the move gizmo drags: its pivot, the parts that follow it live, and the snapping. */
export type TransformSpec = {
  mode: "translate" | "rotate";
  pivot: Vec3;
  nodes: string[];
  members: string[];
  /** Every drawn object follows (whole structure). */
  all: boolean;
  /** Translation step (0 = free). */
  snap: number;
  /** Rotation step in degrees (0 = free). */
  rotationSnap: number;
  /**
   * Constrained rotation about one line (e.g. a board turning on the tenon through its hole): only the
   * ring about `axis` is shown and `limit` returns the angle the drag may actually reach.
   */
  hinge?: { axis: Vec3; limit: (angle: number) => number };
};
export type GizmoMotion = { translate: Vec3; axis: Vec3; angle: number; pivot: Vec3 };
/** Moving ends closer than this to a node that stays put jump onto it. */
const MAGNET = 0.06;

export class Viewport {
  private engineering: EngineeringResult | null = null;
  setEngineering(result: EngineeringResult | null) {
    this.engineering = result;
  }
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
  private spec: TransformSpec | null = null;
  private followers: { object: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];
  /** Gizmo orientation before the drag; a hinge turns the gizmo so its Z ring lies about the hinge axis. */
  private base = new THREE.Quaternion();
  onSelect: (id: string) => void = () => {};
  onMemberSelect: (id: string) => void = () => {};
  onRingSelect: (id: string) => void = () => {};
  /** Called once when a gizmo drag ends with a non-zero motion. */
  onTransform: (motion: GizmoMotion) => void = () => {};
  private choosingFrame = false;
  private selectedFrame = "";
  onFrameSelect: (id: string) => void = () => {};
  onHoleSelect: (female: string, hole: number) => void = () => {};
  private choosingHole = false;
  private chosenHole: { female: string; hole: number } | null = null;
  private preview: { start: Vec3; end: Vec3 } | null = null;
  private hovered = "";
  private ghosts = new Set<string>();
  private marked = new Set<string>();
  private anchors = new Set<string>();
  /** Members drawn as a translucent placement preview (not pickable). */
  setGhosts(members: string[]) {
    this.ghosts = new Set(members);
  }
  /** Members picked as the base of the active tool; they glow softly until released. */
  setMarked(members: string[]) {
    this.marked = new Set(members);
  }
  private resizeHint: { moving: string; fixed: string } | null = null;
  /** The ends of the selected board for catalog resizing: an arrow on the end that moves, a lock on the other. */
  setResizeHint(hint: { moving: string; fixed: string } | null) {
    this.resizeHint = hint;
  }
  /** Nodes offered as starting points for the active tool. */
  setAnchorChoices(nodes: string[]) {
    this.anchors = new Set(nodes);
  }
  private pulseIds = new Set<string>();
  private pulseStart = 0;
  /** Temporarily emphasise a member, e.g. while its result row is hovered. */
  setHover(member: string) {
    this.hovered = member;
  }
  private selectedMember = "";
  private winder = "";
  /** The male chosen to wind the rope being set up; it glows in the rope colour. */
  setWinder(member: string) {
    this.winder = member;
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
      // The rope winder and the selection keep a steady glow of their own colour; the rest light up
      // softly on hover, as a tool's base or in a short flash.
      if (member === this.winder) {
        material.emissive.setHex(0xff5a36);
        material.emissiveIntensity = 0.7;
        continue;
      }
      if (member === this.selectedMember) {
        material.emissive.setHex(0xff9a2e);
        material.emissiveIntensity = Math.max(0.55, this.pulseIds.has(member) ? flash : 0);
        continue;
      }
      const intensity = Math.max(
        this.pulseIds.has(member) ? flash : 0,
        member === this.hovered ? 0.25 : 0,
        this.marked.has(member) ? 0.5 : 0,
      );
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
  private holeMarks: { female: string; hole: number }[] = [];
  /** Holes picked for laying over each other: the first one (blue) stays, the others (orange) turn onto it. */
  setHoleMarks(holes: { female: string; hole: number }[]) {
    this.holeMarks = holes;
  }
  setFrameSelection(choosing: boolean, id: string) {
    this.choosingFrame = choosing;
    this.selectedFrame = id;
  }
  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor("#3a3a3a");
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
    const grid = new THREE.GridHelper(12, 48, 0x5e5e5e, 0x474747);
    grid.position.y = -0.3;
    this.scene.add(grid);
    this.scene.add(this.group);
    this.scene.add(this.anchor);
    const axes = new THREE.AxesHelper(0.65);
    axes.position.set(-0.4, -0.28, -0.4);
    this.scene.add(axes);
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode("translate");
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener("dragging-changed", (event) => {
      this.controls.enabled = !event.value;
    });
    this.transform.addEventListener("mouseDown", () => this.collectFollowers());
    this.transform.addEventListener("objectChange", () => this.dragUpdate());
    this.transform.addEventListener("mouseUp", () => {
      const motion = this.currentMotion();
      this.followers = [];
      if (motion && (Math.hypot(...motion.translate) > 1e-9 || Math.abs(motion.angle) > 1e-9))
        this.onTransform(motion);
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
  setTools(editing: boolean, spec: TransformSpec | null) {
    this.editing = editing;
    this.spec = editing ? spec : null;
    // Translation is snapped relative to the start (see dragUpdate); rotation uses the gizmo's own snap.
    this.transform.setTranslationSnap(null);
    this.transform.setRotationSnap(spec?.rotationSnap ? (spec.rotationSnap * Math.PI) / 180 : null);
    if (spec) this.transform.setMode(spec.mode);
    const hinge = this.spec?.hinge;
    this.transform.setSpace(hinge ? "local" : "world");
    this.transform.showX = !hinge;
    this.transform.showY = !hinge;
    this.base = hinge
      ? new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(...hinge.axis).normalize(),
        )
      : new THREE.Quaternion();
    if (!this.spec) this.transform.detach();
  }
  private collectFollowers() {
    const spec = this.spec;
    if (!spec || !this.current) return;
    const members = new Set(spec.members);
    const nodes = new Set(spec.nodes);
    const rings = new Set(this.current.rings.filter((r) => members.has(r.member)).map((r) => r.id));
    this.followers = [];
    for (const object of this.group.children) {
      const tag = object.userData;
      if (
        spec.all ||
        members.has(tag.member) ||
        members.has(tag.female) ||
        nodes.has(tag.node) ||
        rings.has(tag.ring)
      )
        this.followers.push({
          object,
          position: object.position.clone(),
          quaternion: object.quaternion.clone(),
        });
    }
  }
  private dragUpdate() {
    const spec = this.spec;
    if (!spec || !this.transform.dragging) return;
    const pivot = new THREE.Vector3(...spec.pivot);
    if (spec.mode === "translate") {
      const delta = this.anchor.position.clone().sub(pivot);
      if (spec.snap > 0) delta.divideScalar(spec.snap).round().multiplyScalar(spec.snap);
      this.magnet(delta);
      this.anchor.position.copy(pivot).add(delta);
    }
    if (spec.hinge) {
      // Keep the drag on the hinge and inside the range that does not collide.
      this.anchor.position.copy(pivot);
      const axis = new THREE.Vector3(...spec.hinge.axis).normalize();
      const turn = this.turn();
      const signed = 2 * Math.atan2(new THREE.Vector3(turn.x, turn.y, turn.z).dot(axis), turn.w);
      const allowed = (spec.hinge.limit((signed * 180) / Math.PI) * Math.PI) / 180;
      this.anchor.quaternion.setFromAxisAngle(axis, allowed).multiply(this.base);
    }
    const delta = this.anchor.position.clone().sub(pivot);
    const turn = this.turn();
    for (const f of this.followers) {
      f.object.position.copy(f.position).sub(pivot).applyQuaternion(turn).add(pivot).add(delta);
      f.object.quaternion.copy(turn).multiply(f.quaternion);
    }
  }
  /** Pull the moving nodes onto the nearest node that stays in place, so parts can be joined by dragging. */
  private magnet(delta: THREE.Vector3) {
    const spec = this.spec;
    if (!spec || spec.all || !this.current) return;
    const moving = this.current.nodes.filter((n) => spec.nodes.includes(n.id));
    const still = this.current.nodes.filter((n) => !spec.nodes.includes(n.id));
    let best: THREE.Vector3 | null = null;
    let bestDistance = MAGNET;
    for (const a of moving) {
      const p = new THREE.Vector3(...a.position).add(delta);
      for (const b of still) {
        const q = new THREE.Vector3(...b.position);
        const distance = p.distanceTo(q);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = q.sub(new THREE.Vector3(...a.position));
        }
      }
    }
    if (best) delta.copy(best);
  }
  /** Rotation of the gizmo since the drag started. */
  private turn() {
    return this.anchor.quaternion.clone().multiply(this.base.clone().invert());
  }
  private currentMotion(): GizmoMotion | null {
    const spec = this.spec;
    if (!spec) return null;
    const translate = this.anchor.position
      .clone()
      .sub(new THREE.Vector3(...spec.pivot))
      .toArray() as Vec3;
    const q = this.turn().normalize();
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    const angle = 2 * Math.acos(Math.min(1, q.w));
    const s = Math.sin(angle / 2);
    const axis: Vec3 = s > 1e-9 ? [q.x / s, q.y / s, q.z / s] : [0, 1, 0];
    return { translate, axis, angle: (angle * 180) / Math.PI, pivot: spec.pivot };
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
    highlight: boolean | number,
  ) {
    const ghost = tag.member !== undefined && this.ghosts.has(tag.member);
    const mesh = new THREE.Mesh(
      geometry,
      ghost
        ? new THREE.MeshStandardMaterial({
            color: 0x3d9d86,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
          })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
    );
    mesh.position.copy(position);
    mesh.quaternion.copy(rotation);
    this.group.add(mesh);
    if (ghost) return mesh;
    mesh.userData = tag;
    this.targets.push(mesh);
    if (highlight !== false) {
      // Drawn over everything, so the outline shows even where other parts hide the member.
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({
          color: highlight === true ? 0x2f8cff : highlight,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
        }),
      );
      outline.renderOrder = 9;
      outline.position.copy(position);
      outline.quaternion.copy(rotation);
      outline.userData = { ...tag };
      this.group.add(outline);
    }
    return mesh;
  }
  private line(a: THREE.Vector3, b: THREE.Vector3, color: number, width: number, overlay = false) {
    const delta = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(width, width, delta.length(), 6);
    const mesh = new THREE.Mesh(
      geometry,
      overlay
        ? new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.35,
            depthTest: false,
            depthWrite: false,
          })
        : new THREE.MeshStandardMaterial({ color }),
    );
    if (overlay) mesh.renderOrder = 8;
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
    this.selectedMember = selected.startsWith("member:") ? selected.slice("member:".length) : "";
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
      const highlight =
        selected === `member:${member.id}` ? true : member.id === this.winder ? 0xff5a36 : false;
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
          femaleGeometry(length, design.geometry, member.holeCount, member),
          0xd9bb85,
          a.clone().add(shift),
          frame.quaternion,
          { member: member.id },
          highlight,
        );
      }
    }
    if (this.engineering) {
      const maximum = Math.max(1e-12, ...this.engineering.members.map((m) => m.normalMPa));
      for (const target of this.targets) {
        const member = this.engineering.members.find((m) => m.id === target.userData.member);
        if (member && target instanceof THREE.Mesh && target.material instanceof THREE.MeshStandardMaterial)
          target.material.color.setHSL((1 - member.normalMPa / maximum) * 0.65, 0.85, 0.55);
      }
      for (const element of this.engineering.elements) {
        const points = element.samples.map((s) =>
          new THREE.Vector3(...s.position).addScaledVector(new THREE.Vector3(...s.displacement), scale),
        );
        const curve = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }),
        );
        curve.renderOrder = 10;
        this.group.add(curve);
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
        const color = ropeMode === "slack" ? 0xd8c4a4 : 0xff5a36;
        for (let s = 0; s < 3; s++) {
          this.line(ropePoints[s], ropePoints[s + 1], color, 0.009);
          // A faint copy drawn over everything, so the parts behind boards and tenons stay visible.
          this.line(ropePoints[s], ropePoints[s + 1], color, 0.009, true);
        }
      }
    for (const frame of detectRopeFrames(design))
      if (this.choosingFrame || frame.id === this.selectedFrame)
        this.frameOverlay(frame, points, frame.id === this.selectedFrame);
    for (const member of design.members.filter((m) => m.kind === "female"))
      for (let hole = 0; hole < member.holeCount; hole++) {
        const mark = this.holeMarks.findIndex((h) => h.female === member.id && h.hole === hole);
        const chosen = mark >= 0 || (this.chosenHole?.female === member.id && this.chosenHole.hole === hole);
        if ((!this.choosingHole && !chosen) || holeOccupied(design, member.id, hole)) continue;
        const site = holeSite(design, member.id, hole);
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(chosen ? 0.032 : 0.022, 10, 8),
          new THREE.MeshBasicMaterial({
            color: mark === 0 ? 0x5aa6e6 : chosen ? 0xf4aa34 : 0x269d77,
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
      const anchor = this.anchors.has(node.id);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(selected === node.id ? 0.045 : anchor ? 0.038 : 0.024, 12, 8),
        new THREE.MeshStandardMaterial({
          color: selected === node.id ? 0xf1a043 : anchor ? 0x2fbf8f : node.fixed ? 0x275d4d : 0xeee6d0,
          transparent: true,
          opacity: labels || anchor ? 0.9 : 0,
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
        support.userData = { node: node.id };
        this.group.add(support);
      }
    }
    const hint = this.resizeHint;
    const moving = hint ? points.get(hint.moving) : undefined;
    const fixedEnd = hint ? points.get(hint.fixed) : undefined;
    if (moving && fixedEnd) {
      // Double arrow along the board at the end that moves: outward lengthens, inward shortens.
      const along = moving.clone().sub(fixedEnd).normalize();
      for (const sign of [1, -1]) {
        const arrow = new THREE.ArrowHelper(
          along.clone().multiplyScalar(sign),
          moving.clone().addScaledVector(along, sign * 0.04),
          0.2,
          0xf1a043,
          0.07,
          0.05,
        );
        // Drawn on top: the inward arrow and the lock sit inside the board and the tenon.
        for (const part of [arrow.line, arrow.cone]) {
          for (const material of Array.isArray(part.material) ? part.material : [part.material])
            material.depthTest = false;
          part.renderOrder = 10;
        }
        this.group.add(arrow);
      }
      const lock = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 0.06),
        new THREE.MeshStandardMaterial({
          color: 0x5aa6e6,
          transparent: true,
          opacity: 0.85,
          depthTest: false,
        }),
      );
      lock.renderOrder = 10;
      lock.position.copy(fixedEnd);
      this.group.add(lock);
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
    if (this.editing && this.spec && !displacement && !this.transform.dragging) {
      this.anchor.position.set(...this.spec.pivot);
      this.anchor.quaternion.copy(this.base);
      this.transform.attach(this.anchor);
    } else if (!this.transform.dragging) this.transform.detach();
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
  /** Reframe only when one of the given nodes has left the visible part of the view. */
  fitIfOutside(nodeIds: string[]) {
    if (!this.current) return;
    this.camera.updateMatrixWorld();
    const outside = this.current.nodes
      .filter((n) => nodeIds.includes(n.id))
      .some((n) => {
        const p = new THREE.Vector3(...n.position).project(this.camera);
        return p.z > 1 || Math.abs(p.x) > 0.9 || Math.abs(p.y) > 0.9;
      });
    if (outside) this.fit();
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
