/* ==========================================================================
   لقطة — تسجيل معاينة الكاميرا كفيديو
   بننسخ كل إطار من لوحة WebGL للوحة 2D، وبنسجّلها بـ MediaRecorder.
   سفاري على الآيفون بيطلّع MP4، وكروم بيطلّع WebM.
   ========================================================================== */

const TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export class Recorder {
  static supported() {
    return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
  }

  start(width, height, fps = 30) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, width, height);

    const stream = this.canvas.captureStream(fps);
    this.mime = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const opts = { videoBitsPerSecond: 10_000_000 };
    if (this.mime) opts.mimeType = this.mime;
    this.chunks = [];
    this.rec = new MediaRecorder(stream, opts);
    this.rec.ondataavailable = (e) => e.data && e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
  }

  capture(src) {
    if (!this.ctx) return;
    this.ctx.drawImage(src, 0, 0, this.canvas.width, this.canvas.height);
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') return resolve(null);
      this.rec.onstop = () => {
        const type = this.rec.mimeType || this.mime || 'video/webm';
        const blob = new Blob(this.chunks, { type });
        this.ctx = null;
        resolve({ blob, ext: type.includes('mp4') ? 'mp4' : 'webm' });
      };
      this.rec.stop();
    });
  }
}
