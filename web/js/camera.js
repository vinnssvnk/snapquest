// Live camera viewfinder + full-resolution capture, with a file-picker fallback.

export const cameraSupported = () => !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia);

export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;
  await video.play();
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

export async function capture(video, stream) {
  // ImageCapture gives the full sensor resolution on Android Chrome.
  const track = stream?.getVideoTracks()[0];
  if (track && "ImageCapture" in window) {
    try {
      const blob = await new window.ImageCapture(track).takePhoto();
      if (blob?.size) return blob;
    } catch { /* fall back to a video frame */ }
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
}
