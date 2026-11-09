# Pixel-grid check: every art pixel is a uniform scale x scale block, every colour on the palette.
import sys, numpy as np
from PIL import Image
PAL = ['0b0c0e','16181b','202327','2b2f34','383d43','4a5058','5f666e','7a828a','98a0a6','c3c7c4','3a2418','5a3420','7d4a2a','a3683a','6e5a2c','9c7e3e','c9a85a','1c2a24','2c4038','445e50','6c8a72','d8c9a3','b8a77e','8e7f5c','efe6cc','2a2a3a','3e4a6a','8a1c1c','c23a2a','e0a030','f2d27a','f4f1e6']
pal = {tuple(int(h[i:i+2], 16) for i in (0, 2, 4)) for h in PAL}
path, s, ox, oy = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
a = np.asarray(Image.open(path).convert('RGB')).astype(np.int32)
H, W, _ = a.shape
x0, y0 = ox % s, oy % s
b = a[y0:y0 + (H - y0) // s * s, x0:x0 + (W - x0) // s * s]
blocks = b.reshape(b.shape[0] // s, s, b.shape[1] // s, s, 3)
bad = int((blocks != blocks[:, :1, :, :1, :]).any(axis=(1, 3, 4)).sum())
cols = {tuple(c) for c in a.reshape(-1, 3)}
off = [c for c in cols if c not in pal]
print({'file': path.split('/')[-1], 'blocks': blocks.shape[0] * blocks.shape[2], 'nonUniform': bad, 'colours': len(cols), 'offPalette': len(off)})
