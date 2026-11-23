'use strict';
// Selecție: faces and closed eyes, found on this computer with MediaPipe Face Landmarker (Apache-2.0, in vendor/).
// Each face gets "blink" scores for both eyes; a face counts as blinking when both eyes are mostly shut.
// Faces smaller than 6% of the frame's width are skipped: in a group photo their eyes are too small to judge.
const EYES = { lm: null, failed: false };

async function eyesReady() {
  if (EYES.lm || EYES.failed) return EYES.lm;
  try {
    const v = await import('./vendor/mediapipe/vision_bundle.mjs');
    const files = await v.FilesetResolver.forVisionTasks('vendor/mediapipe/wasm');
    const opts = delegate => ({ baseOptions: { modelAssetPath: 'vendor/mediapipe/face_landmarker.task', delegate },
      runningMode: 'IMAGE', numFaces: 12, outputFaceBlendshapes: true, minFaceDetectionConfidence: 0.5 });
    try { EYES.lm = await v.FaceLandmarker.createFromOptions(files, opts('GPU')); }
    catch { EYES.lm = await v.FaceLandmarker.createFromOptions(files, opts('CPU')); }
  } catch (e) {
    EYES.failed = true;
    console.warn('eyes: unavailable', e);
  }
  return EYES.lm;
}

/** {faces, eyes_closed, blink} for one picture (a data: or same-origin address). */
async function eyesOf(src) {
  const lm = await eyesReady();
  if (!lm) return null;
  const img = new Image();
  img.src = src;
  await img.decode();
  const r = lm.detect(img);
  let faces = 0, closed = 0, worst = 0;
  (r.faceLandmarks || []).forEach((pts, i) => {
    const xs = pts.map(p => p.x), width = Math.max(...xs) - Math.min(...xs);
    if (width < 0.06) return;
    faces++;
    const cats = (r.faceBlendshapes[i] || { categories: [] }).categories;
    const score = name => (cats.find(c => c.categoryName === name) || { score: 0 }).score;
    const blink = Math.min(score('eyeBlinkLeft'), score('eyeBlinkRight'));
    worst = Math.max(worst, blink);
    if (blink > 0.6) closed++; // 0.55 is still a look down at the phone
  });
  return { faces, eyes_closed: closed > 0, blink: Math.round(worst * 100) / 100 };
}
