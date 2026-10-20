"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export interface RadarPingJob {
  title: string;
  company: string;
  score: number;
}

interface RadarCanvasProps {
  /** Ranked listings feeding the radar pips (idle radar when empty). */
  listings: RadarPingJob[];
  soundOn: boolean;
  onPing: (job: RadarPingJob | null) => void;
  /** 0 = hero framing (globe on right third), 1 = zoomed to centre (preferences veil). */
  zoom: number;
}

/* greys for the model; the detection accent is the only colour */
const GREY_CORE = new THREE.Color("#e2e2e6");
const GREY_WIRE = new THREE.Color("#b9b9c2");
const GREY_RING = new THREE.Color("#a4a4ad");
const GREY_PIP = new THREE.Color("#a8a8b2");
const GREY_PIP_ACTIVE = new THREE.Color("#6f6f79");
const DETECT = new THREE.Color("#ff452a");
const DETECT_HOT = new THREE.Color("#ff8a1e");
const TRAIL_LEN = 26;

function makeCircleLine(radius: number, segments = 160): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  grad.addColorStop(0.3, "rgba(255, 255, 255, 0.35)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function escapeHtml(value: string): string {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
}

export default function RadarCanvas({ listings, soundOn, onPing, zoom }: RadarCanvasProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const listingsRef = useRef<RadarPingJob[]>(listings);
  const soundRef = useRef(soundOn);
  const onPingRef = useRef(onPing);
  const zoomRef = useRef(zoom);
  listingsRef.current = listings;
  soundRef.current = soundOn;
  onPingRef.current = onPing;
  zoomRef.current = zoom;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    /* ================= stage ================= */
    const scene = new THREE.Scene();
    const BASE_CAM_Z = 8.6;
    const ZOOM_CAM_Z = 4.05;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    camera.position.set(0, 0.35, BASE_CAM_Z);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setClearColor(0x000000, 0);
    /* DPR capped at 1.5: the glass globe is low-contrast, so the visual change is
       invisible — but fill cost on retina screens drops by ~56% (1.5² vs 2²). */
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const canvasEl = renderer.domElement;
    canvasEl.style.cssText = "position:absolute;inset:0;";
    box.appendChild(canvasEl);

    const labelLayer = document.createElement("div");
    labelLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
    box.appendChild(labelLayer);

    const root = new THREE.Group();
    scene.add(root);

    /* ================= lights ================= */
    const ambient = new THREE.AmbientLight(new THREE.Color("#ffffff"), 1.15);
    const keyLight = new THREE.DirectionalLight(new THREE.Color("#ffffff"), 2.6);
    keyLight.position.set(3, 4, 6);
    const rimLight = new THREE.DirectionalLight(new THREE.Color("#9c9ca4"), 1.5);
    rimLight.position.set(-4, -2, -3);
    scene.add(ambient, keyLight, rimLight);

    /* ================= globe (liquid glass, grey) ================= */
    const globeGroup = new THREE.Group();
    globeGroup.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(1.55, 40, 40),
        new THREE.MeshPhysicalMaterial({
          color: GREY_CORE,
          roughness: 0.14,
          metalness: 0,
          transparent: true,
          opacity: 0.42,
          clearcoat: 1,
          clearcoatRoughness: 0.12,
          reflectivity: 0.6
        })
      ),
      new THREE.Mesh(
        new THREE.SphereGeometry(1.56, 24, 18),
        new THREE.MeshBasicMaterial({ color: GREY_WIRE, wireframe: true, transparent: true, opacity: 0.16 })
      ),
      new THREE.Mesh(
        new THREE.SphereGeometry(1.62, 16, 12),
        new THREE.MeshBasicMaterial({ color: GREY_WIRE, wireframe: true, transparent: true, opacity: 0.06 })
      )
    );
    root.add(globeGroup);

    const glowTexture = makeGlowTexture();
    const glowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture, color: GREY_CORE, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    glowSprite.scale.setScalar(6.8);
    root.add(glowSprite);

    /* ================= orbit rings ================= */
    const rings = [
      { radius: 2.35, tiltX: 1.32, tiltZ: 0.18 },
      { radius: 2.95, tiltX: 1.06, tiltZ: -0.42 },
      { radius: 3.55, tiltX: 0.55, tiltZ: 0.9 }
    ];
    const ringGroups = rings.map(ring => {
      const group = new THREE.Group();
      group.rotation.x = ring.tiltX;
      group.rotation.z = ring.tiltZ;
      group.userData.baseTiltX = ring.tiltX;
      group.userData.baseTiltZ = ring.tiltZ;
      group.userData.radius = ring.radius;
      group.add(
        new THREE.Line(makeCircleLine(ring.radius), new THREE.LineBasicMaterial({ color: GREY_RING, transparent: true, opacity: 0.5 })),
        new THREE.Line(makeCircleLine(ring.radius + 0.02), new THREE.LineBasicMaterial({ color: GREY_RING, transparent: true, opacity: 0.16 }))
      );
      root.add(group);
      return group;
    });

    /* ================= pips ================= */
    interface Pip {
      mesh: THREE.Mesh;
      sprite: THREE.Sprite;
      trail: THREE.Line;
      trailAttr: THREE.BufferAttribute;
      trailGeo: THREE.BufferGeometry;
      group: THREE.Group;
      radius: number;
      speed: number;
      angle: number;
      pulse: number;
      lastFrontness: number;
      jobIndex: number;
      idleLabel: string;
      label: HTMLDivElement;
    }

    const pips: Pip[] = [];
    let pipCounter = 0;
    ringGroups.forEach(group => {
      const radius = group.userData.radius as number;
      for (let i = 0; i < 4; i++) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 10), new THREE.MeshBasicMaterial({ color: GREY_PIP }));
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glowTexture, color: GREY_PIP, transparent: true, opacity: 0.7,
            blending: THREE.AdditiveBlending, depthWrite: false
          })
        );
        sprite.scale.setScalar(0.62);
        const trailAttr = new THREE.BufferAttribute(new Float32Array(TRAIL_LEN * 3), 3);
        const trailGeo = new THREE.BufferGeometry();
        trailGeo.setAttribute("position", trailAttr);
        const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: GREY_PIP, transparent: true, opacity: 0.2 }));
        root.add(mesh, sprite, trail);

        const label = document.createElement("div");
        label.className = "pip-label";
        label.style.opacity = "0";
        labelLayer.appendChild(label);

        pips.push({
          mesh, sprite, trail, trailAttr, trailGeo, group, radius,
          speed: (0.1 + Math.random() * 0.14) * (pipCounter % 2 ? 1 : -1),
          angle: ((pipCounter % 4) / 4) * Math.PI * 2 + Math.floor(pipCounter / 4) * 0.9,
          pulse: 0,
          lastFrontness: -1,
          jobIndex: pipCounter,
          idleLabel: ["SCANNING", "LISTENING", "SWEEPING", "TRACKING"][pipCounter % 4],
          label
        });
        pipCounter++;
      }
    });

    /* ================= framing (rule of thirds + scroll zoom) ================= */
    const resize = () => {
      renderer.setSize(box.clientWidth, box.clientHeight);
      camera.aspect = box.clientWidth / box.clientHeight;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    resize();

    /* ================= ping audio — silent (visual flash only) ================= */
    const beep = () => {
      /* radar sound removed */
    };

    /* ================= frame ================= */
    const projected = new THREE.Vector3();
    let zoomEased = 0;
    let time = 0;

    const labelHtml = (pip: Pip) => {
      const jobs = listingsRef.current;
      const job = pip.jobIndex < jobs.length ? jobs[pip.jobIndex] : null;
      if (job) {
        const clipped = job.title.length > 34 ? `${job.title.slice(0, 34)}…` : job.title;
        return `<span class="co">${escapeHtml((job.company || "career page").toUpperCase())}</span>${escapeHtml(clipped)} · <b>${Math.round(job.score)} FIT</b>`;
      }
      if (jobs.length === 0) {
        return `<span class="co">RADAR · ${pip.idleLabel}</span>searching career pages`;
      }
      return "";
    };

    const animate = (dt: number) => {
      time += 0.016 * dt;

      // smooth the scroll-driven zoom (lerp factor compensated for frame delta,
      // so easing feels identical at the ~30fps render cap)
      zoomEased += (zoomRef.current - zoomEased) * (dt >= 1 ? 0.06 : 1 - Math.pow(0.94, dt));
      const t = zoomEased * zoomEased * (3 - 2 * zoomEased); // smoothstep
      camera.position.z = BASE_CAM_Z + (ZOOM_CAM_Z - BASE_CAM_Z) * t;
      const worldHalfW = Math.tan(THREE.MathUtils.degToRad(21)) * camera.position.z * camera.aspect;
      const homeX = Math.max(1.6, worldHalfW / 2);
      root.position.x = homeX * (1 - t);
      root.position.y = 0.1 * (1 - t) - 0.05 * t;
      root.scale.setScalar(1 + 0.28 * t);

      globeGroup.rotation.y = time * 0.085;
      glowSprite.material.opacity = 0.16 + Math.sin(time * 1.5) * 0.03;

      ringGroups.forEach((group, i) => {
        group.rotation.z = (group.userData.baseTiltZ as number) + Math.sin(time * 0.11 + i) * 0.07;
        group.rotation.x = (group.userData.baseTiltX as number) + Math.cos(time * 0.07 + i * 1.7) * 0.05;
      });

      const jobs = listingsRef.current;
      for (const pip of pips) {
        const job = pip.jobIndex < jobs.length ? jobs[pip.jobIndex] : null;
        // accent "detected" carriers: with results, the two top fits; idle, three signal pips
        let baseColor: THREE.Color;
        if (job && pip.jobIndex < 2) {
          baseColor = pip.jobIndex === 0 ? DETECT : DETECT_HOT;
        } else if (!job && jobs.length === 0 && pip.jobIndex % 5 === 0) {
          baseColor = (pip.jobIndex / 5) % 2 === 0 ? DETECT : DETECT_HOT;
        } else {
          baseColor = job ? GREY_PIP_ACTIVE : GREY_PIP;
        }
        const hot = baseColor === DETECT || baseColor === DETECT_HOT;
        (pip.mesh.material as THREE.MeshBasicMaterial).color.copy(baseColor);
        (pip.sprite.material as THREE.SpriteMaterial).color.copy(baseColor);
        (pip.trail.material as THREE.LineBasicMaterial).color.copy(baseColor);

        pip.angle += pip.speed * 0.016 * dt * (job ? 1.35 : 1);
        pip.mesh.position.set(Math.cos(pip.angle) * pip.radius, Math.sin(pip.angle) * pip.radius, 0);
        projected.copy(pip.mesh.position).applyEuler(pip.group.rotation);

        const frontness = projected.z / pip.radius;
        const crossing = pip.lastFrontness < 0.62 && frontness >= 0.62;
        if (hot && crossing) {
          if (job) {
            beep();
            onPingRef.current({ ...job });
          }
          pip.pulse = 1;
        }
        pip.lastFrontness = frontness;

        if (pip.pulse > 0) {
          pip.pulse = Math.max(0, pip.pulse - 0.016 * dt);
          const flash = Math.sin(pip.pulse * Math.PI);
          pip.mesh.scale.setScalar(1 + flash * 2.2);
          (pip.mesh.material as THREE.MeshBasicMaterial).color.lerpColors(baseColor, DETECT, flash);
          (pip.sprite.material as THREE.SpriteMaterial).color.lerpColors(baseColor, flash > 0.6 ? DETECT_HOT : DETECT, flash);
          (pip.sprite.material as THREE.SpriteMaterial).opacity = 0.5 + flash * 0.5;
          pip.sprite.scale.setScalar(0.62 + flash * 0.55);
        } else {
          pip.mesh.scale.setScalar(1);
          const breath = hot ? (Math.sin(time * 2.2 + pip.jobIndex * 1.3) + 1) / 2 : 0;
          (pip.sprite.material as THREE.SpriteMaterial).opacity = hot ? 0.62 + breath * 0.28 : 0.7;
          pip.sprite.scale.setScalar(0.62 + breath * 0.18);
        }

        const arr = pip.trailAttr.array as Float32Array;
        for (let k = TRAIL_LEN - 1; k > 0; k--) {
          arr[k * 3] = arr[(k - 1) * 3];
          arr[k * 3 + 1] = arr[(k - 1) * 3 + 1];
          arr[k * 3 + 2] = arr[(k - 1) * 3 + 2];
        }
        arr[0] = projected.x;
        arr[1] = projected.y;
        arr[2] = projected.z;
        pip.trailAttr.needsUpdate = true;
        pip.trailGeo.setDrawRange(0, TRAIL_LEN);
      }

      // labels (screen-space)
      for (const pip of pips) {
        projected.copy(pip.mesh.position).applyEuler(pip.group.rotation).project(camera);
        const x = (projected.x * 0.5 + 0.5) * box.clientWidth;
        const y = (-projected.y * 0.5 + 0.5) * box.clientHeight;
        const facing = Math.max(0, Math.min(1, (pip.lastFrontness - 0.4) / 0.6));
        const jobsNow = listingsRef.current;
        const hasJob = pip.jobIndex < jobsNow.length;
        const visible = hasJob && facing > 0.05;
        pip.label.style.transform = `translate(${x.toFixed(1)}px, ${(y - 18).toFixed(1)}px) translate(-50%, -100%)`;
        pip.label.style.opacity = visible ? facing.toFixed(2) : "0";
        pip.label.classList.toggle("flash", pip.pulse > 0.45);
        const html = labelHtml(pip);
        if (pip.label.dataset.html !== html) {
          pip.label.dataset.html = html;
          pip.label.innerHTML = html;
        }
      }

      renderer.render(scene, camera);
    };

    const renderStatic = () => {
      zoomEased = zoomRef.current;
      globeGroup.rotation.set(0.2, 1.4, 0);
      for (const pip of pips) {
        pip.mesh.position.set(Math.cos(pip.angle) * pip.radius, Math.sin(pip.angle) * pip.radius, 0);
        projected.copy(pip.mesh.position).applyEuler(pip.group.rotation);
        const arr = pip.trailAttr.array as Float32Array;
        for (let k = 0; k < TRAIL_LEN; k++) {
          arr[k * 3] = projected.x;
          arr[k * 3 + 1] = projected.y;
          arr[k * 3 + 2] = projected.z;
        }
        pip.trailAttr.needsUpdate = true;
      }
      renderer.render(scene, camera);
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    if (reduced) {
      renderStatic();
    } else {
      let lastFrame = 0;
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        /* ~30fps cap: delta-time keeps motion at the same visual speed as before,
           while per-second main-thread + GPU work drops by roughly half — the single
           biggest Total-Blocking-Time win on slow phones. */
        if (lastFrame && now - lastFrame < 30) return;
        const frameSpan = lastFrame ? Math.min(now - lastFrame, 100) : 16.667;
        lastFrame = now;
        animate(frameSpan / 16.667);
      };
      loop(0);
    }

    /* ================= teardown ================= */
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse(obj => {
        const anyObj = obj as THREE.Mesh & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
        anyObj.geometry?.dispose?.();
        if (Array.isArray(anyObj.material)) anyObj.material.forEach(m => m.dispose());
        else anyObj.material?.dispose?.();
      });
      glowTexture.dispose();
      renderer.dispose();
      canvasEl.remove();
      labelLayer.remove();
    };
  }, []);

  return <div ref={boxRef} className="stage" aria-hidden="true" />;
}
