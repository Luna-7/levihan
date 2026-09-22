/** 把任意原图压成单次云函数请求可承载的 WebP，不限制选取文件的原始大小。 */
export async function toForumWebp(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif|avif|heic|heif)$/i.test(file.type)) {
    throw new Error('请选择浏览器支持的图片格式');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const source = new Image();
    source.src = objectUrl;
    await source.decode();
    if (!source.naturalWidth || !source.naturalHeight) throw new Error('图片无法读取');

    let maxEdge = 2560;
    let quality = 0.84;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const ratio = Math.min(1, maxEdge / Math.max(source.naturalWidth, source.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(source.naturalHeight * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法处理这张图片');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/webp', quality);
      canvas.width = canvas.height = 0;
      if (!dataUrl.startsWith('data:image/webp;base64,')) throw new Error('浏览器不支持 WebP 转换');
      // 云函数请求体上限 6MB、单图上限 4MB；5M Base64 字符约为 3.75MB。
      if (dataUrl.length <= 5_000_000) return dataUrl;
      quality = Math.max(0.45, quality - 0.1);
      maxEdge = Math.max(640, Math.round(maxEdge * 0.78));
    }
    throw new Error('图片转换后仍过大，请选择另一张图片');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
