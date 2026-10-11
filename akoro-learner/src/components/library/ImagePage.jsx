/**
 * ImagePage — an image record's page, made selectable.
 *
 * An image has no text of its own. Once its text is extracted, each layout
 * block (bbox_2d, normalized 0-1000) is laid transparently over the spot
 * it was read from — the same approach as a scanned PDF page — so the
 * learner can select words on the picture and Ask, Annotate or Hide them.
 * Without an extraction it is just the image.
 */
import { useEffect, useRef, useState } from 'react';
import BlockTextLayer from './BlockTextLayer.jsx';

export default function ImagePage({ src, alt = '', blocks = null }) {
  const imgRef = useRef(null);
  const [height, setHeight] = useState(0);   // rendered height — sizes the invisible type
  // A CORS-readable copy of the picture: the text layer finds the printed
  // lines in its pixels. The shown <img> stays plain, so a host without
  // CORS still DISPLAYS; the layer then falls back to estimating.
  const [pixels, setPixels] = useState(null);
  useEffect(() => {
    if (!src || !blocks?.length) { setPixels(null); return undefined; }
    let live = true;
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => { if (live) setPixels(im); };
    im.onerror = () => { if (live) setPixels(null); };
    im.src = src;
    return () => { live = false; };
  }, [src, blocks]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return undefined;
    const ro = new ResizeObserver(() => setHeight(img.clientHeight || 0));
    ro.observe(img);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <img ref={imgRef} src={src} alt={alt} onLoad={(e) => setHeight(e.currentTarget.clientHeight || 0)}
        style={{ width: '100%', height: 'auto', borderRadius: 8, display: 'block' }}/>
      <BlockTextLayer blocks={blocks} height={height} surface={pixels} surfaceKey={pixels ? 1 : 0}/>
    </div>
  );
}
