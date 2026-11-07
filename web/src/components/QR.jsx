import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

export default function QR({ value, size = 280, light = '#ffffff', dark = '#000000' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, value, {
      width: size,
      margin: 1,
      color: { light, dark },
      errorCorrectionLevel: 'M',
    }).catch(() => {});
  }, [value, size, light, dark]);
  return <canvas ref={ref} width={size} height={size} aria-label={`QR: ${value}`} />;
}
