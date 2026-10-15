import { detectDocument } from '../imaging/detect';
import type { Quad } from '../imaging/geometry';
import { drawScaled, loadImage } from '../imaging/image';
import { busy, errorMessage, h, iconButton, toast } from '../ui/dom';
import { pop, type Screen } from '../ui/router';
import { importInto, startCrop } from './flow';

interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

/** Live camera with page-outline overlay. */
export function cameraScreen(docId: string | null): Screen {
  const video = h('video', { class: 'cam-video', autoplay: true, muted: true, playsInline: true });
  const overlay = h('canvas', { class: 'cam-overlay' });
  const status = h('p', { class: 'cam-status' }, 'Starting camera…');
  const shutter = h('button', { class: 'shutter', 'aria-label': 'Capture page', onclick: () => void capture() });
  let stream: MediaStream | null = null;
  let timer = 0;
  let active = true;
  let quad: Quad | null = null;

  async function start() {
    stop();
    status.hidden = false;
    status.textContent = 'Starting camera…';
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'No camera access here. Import a photo instead.';
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      });
      if (!active) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      video.srcObject = s;
      await video.play();
      status.hidden = true;
      tick();
    } catch (e) {
      status.textContent = `Camera unavailable (${errorMessage(e)}). Import a photo instead.`;
    }
  }

  function stop() {
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    quad = null;
    draw();
  }

  function tick() {
    timer = window.setTimeout(() => {
      if (video.readyState >= 2 && video.videoWidth) {
        quad = detectDocument(video, video.videoWidth, video.videoHeight);
        draw();
      }
      if (stream) tick();
    }, 250);
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const cw = overlay.clientWidth;
    const ch = overlay.clientHeight;
    overlay.width = Math.round(cw * dpr);
    overlay.height = Math.round(ch * dpr);
    const ctx = overlay.getContext('2d');
    if (!ctx || !quad || !video.videoWidth) return;
    // The video uses object-fit: contain.
    const s = Math.min(cw / video.videoWidth, ch / video.videoHeight);
    const ox = (cw - video.videoWidth * s) / 2;
    const oy = (ch - video.videoHeight * s) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    quad.forEach((p, i) => (i ? ctx.lineTo(ox + p.x * s, oy + p.y * s) : ctx.moveTo(ox + p.x * s, oy + p.y * s)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(20, 184, 166, 0.18)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2dd4bf';
    ctx.stroke();
  }

  async function capture() {
    if (!stream || shutter.disabled) return;
    shutter.disabled = true;
    const done = await busy('Capturing…');
    try {
      let shot: HTMLCanvasElement | null = null;
      const track = stream.getVideoTracks()[0];
      const IC = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
      if (IC && track) {
        // Full sensor resolution when supported; the video frame otherwise.
        try {
          shot = await loadImage(await withTimeout(new IC(track).takePhoto(), 5000));
        } catch {
          shot = null;
        }
      }
      shot ??= drawScaled(video, video.videoWidth, video.videoHeight, 3200);
      stop();
      startCrop(docId, shot);
    } catch (e) {
      toast(errorMessage(e), true);
    } finally {
      done();
      shutter.disabled = false;
    }
  }

  const el = h('div', { class: 'camera' },
    h('header', { class: 'bar dark' }, iconButton('back', 'Back', () => pop()), h('span', { class: 'bar-title' }, 'Scan')),
    h('div', { class: 'cam-stage' }, video, overlay, status),
    h('div', { class: 'cam-controls' },
      iconButton('image', 'Import photo', () => void importInto(docId), 'round'),
      shutter,
      h('span', { class: 'round-spacer' }),
    ),
  );
  void start();
  return {
    name: 'camera',
    el,
    pause() {
      active = false;
      stop();
    },
    resume() {
      active = true;
      void start();
    },
    dispose() {
      active = false;
      stop();
    },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}
