/**
 * useProctoring.js
 *
 * Frontend proctoring hook — the fast, private, low-latency tier.
 *
 * Runs BlazeFace (TensorFlow.js) locally in the browser to derive cheap
 * signals every ~2s: how many faces are present, whether the candidate is
 * looking away (rough head yaw from face landmarks), and an audio noise level
 * from the mic. It downscales each frame to 320x240 and hands both the JPEG
 * and the signals back to the caller, which forwards them over the WebSocket
 * to the backend's heavier pipeline (object detection, identity, temporal).
 *
 * TF.js loads lazily so the rest of the app isn't blocked by the model.
 */

import { useEffect, useRef, useState, useCallback } from "react";

const FRAME_W = 320, FRAME_H = 240;
const CAPTURE_MS = 2000;

export function useProctoring({ enabled = true, onFrame } = {}) {
  const [status, setStatus]   = useState("idle");   // idle|loading|running|denied|error
  const [signals, setSignals] = useState({ faceCount: 0, facePresent: false, lookingAway: false, audioLevel: 0 });

  const videoElRef = useRef(null);
  const canvasRef  = useRef(null);
  const modelRef   = useRef(null);
  const streamRef  = useRef(null);
  const timerRef   = useRef(null);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // Callback ref: the consent screen and the exam monitor render DIFFERENT
  // <video> elements at different times. Re-attach the live stream whenever a
  // new element mounts — an object ref only got the stream at init time, so
  // the exam-phase video stayed black and capture() never saw a ready frame.
  const videoRef = useCallback((node) => {
    videoElRef.current = node;
    if (node && streamRef.current && node.srcObject !== streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(() => {});
    }
  }, []);

  /* Capture one frame: run face detection, read audio, emit signals + JPEG. */
  const capture = useCallback(async () => {
    const video  = videoElRef.current;
    const canvas = canvasRef.current;
    const model  = modelRef.current;
    if (!video || !canvas || !model || video.readyState < 2) return;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, FRAME_W, FRAME_H);

    let faceCount = 0, lookingAway = false;
    try {
      const faces = await model.estimateFaces(canvas, false);
      faceCount = faces.length;
      if (faceCount === 1) {
        // BlazeFace landmarks: [rightEye, leftEye, nose, mouth, rightEar, leftEar].
        const f = faces[0];
        const [x1] = f.topLeft, [x2] = f.bottomRight;
        const nose = f.landmarks?.[2];
        if (nose) {
          const faceCenter = (x1 + x2) / 2;
          const halfWidth  = Math.max(1, (x2 - x1) / 2);
          // Nose offset from face center, normalized — large offset ⇒ head turned.
          lookingAway = Math.abs(nose[0] - faceCenter) / halfWidth > 0.55;
        }
      }
    } catch { /* model hiccup — skip this frame's face read */ }

    // Audio RMS (0–1).
    let audioLevel = 0;
    if (analyserRef.current) {
      const buf = new Uint8Array(analyserRef.current.fftSize);
      analyserRef.current.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      audioLevel = Math.min(1, Math.sqrt(sum / buf.length) * 4);
    }

    const next = { faceCount, facePresent: faceCount > 0, lookingAway, audioLevel: +audioLevel.toFixed(3) };
    setSignals(next);

    // 320x240 JPEG, no data: prefix (backend strips anyway, but keep it small).
    const jpeg = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
    onFrameRef.current?.({ frame: jpeg, signals: next });
  }, []);

  /* Capture a single high-quality still for identity registration. */
  const captureReference = useCallback(() => {
    const video = videoElRef.current, canvas = canvasRef.current;
    if (!video || !canvas) return null;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, FRAME_W, FRAME_H);
    return canvas.toDataURL("image/jpeg", 0.85);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      try {
        setStatus("loading");
        // Lazy-load TF.js + model so they don't block initial render.
        const [tf, blazeface] = await Promise.all([
          import("@tensorflow/tfjs"),
          import("@tensorflow-models/blazeface"),
        ]);
        await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
        await tf.ready();
        if (cancelled) return;
        modelRef.current = await blazeface.load();

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: true,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        const video = videoElRef.current;
        if (video) { video.srcObject = stream; await video.play().catch(() => {}); }

        // Wire audio analyser.
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          const actx = new AC();
          const src  = actx.createMediaStreamSource(stream);
          const an   = actx.createAnalyser();
          an.fftSize = 512;
          src.connect(an);
          audioCtxRef.current = actx;
          analyserRef.current = an;
        } catch { /* audio optional */ }

        setStatus("running");
        timerRef.current = setInterval(capture, CAPTURE_MS);
      } catch (e) {
        if (cancelled) return;
        setStatus(e?.name === "NotAllowedError" ? "denied" : "error");
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [enabled, capture]);

  return { videoRef, canvasRef, status, signals, captureReference, FRAME_W, FRAME_H };
}
