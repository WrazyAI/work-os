"""Extract generated pixels and assemble Otto's atlas; never synthesize artwork.

Requires Pillow, numpy and scipy. Run from any directory; source PNGs and all
transforms are versioned. Components, rather than assumed equal source slots,
identify poses. A shared transform per row preserves body scale and jump lift.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "brand/otto/source"
OUTPUT = ROOT / "desktop/work-os-companion/public/otto"
STATES = [("idle", 6), ("running-right", 8), ("running-left", 8),
          ("waving", 4), ("jumping", 5), ("failed", 8), ("waiting", 6),
          ("running", 6), ("review", 6), ("look-9", 8), ("look-10", 8)]


def extract_poses(image, count):
    # Erode one pixel to disconnect fringe specks. Recover original edge pixels
    # only around accepted complete figures; no color key can punch eye holes.
    image = image.convert("RGBA")
    core = np.array(image.getchannel("A").filter(ImageFilter.MinFilter(3))) > 180
    labels, _ = ndimage.label(core)
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    ids = np.argsort(sizes)[-count:]
    if len(ids) != count or min(sizes[ids]) < 100 or min(sizes[ids]) < max(sizes[ids]) * .45:
        raise ValueError(f"Expected {count} complete separated poses; areas={sorted(sizes[ids].tolist())}")
    remaining = np.delete(sizes, ids)
    if max(remaining, default=0) > min(sizes[ids]) * .2:
        raise ValueError("Unassigned substantial artwork; inspect source frame count")
    poses = []
    for label in ids:
        mask = Image.fromarray(np.uint8(labels == label) * 255).filter(ImageFilter.MaxFilter(5))
        alpha = np.minimum(np.array(mask), np.array(image.getchannel("A")))
        pose = image.copy()
        pose.putalpha(Image.fromarray(alpha))
        bbox = pose.getbbox()
        # The monitor is the stable identity/scale anchor, not an extended arm.
        head = pose.crop((bbox[0], bbox[1], bbox[2], bbox[1] + int((bbox[3] - bbox[1]) * .42))).getbbox()
        poses.append({"image": pose, "bbox": bbox, "head_width": head[2] - head[0]})
    return sorted(poses, key=lambda pose: pose["bbox"][0])


def save_atlas(atlas, output):
    atlas.save(output / "otto-v2.png", optimize=True)
    atlas.save(output / "otto-v2.webp", lossless=True, exact=True, method=6)


def build():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    rows = [extract_poses(Image.open(SOURCE / f"{name}.png"), count) for name, count in STATES]
    scales = [120 / float(np.median([pose["head_width"] for pose in row])) for row in rows]
    # Both direction rows use the same transform, never independently fitted.
    scales[10] = scales[9]
    atlas = Image.new("RGBA", (1536, 2288))
    metrics = []
    for row_index, ((name, count), poses, scale) in enumerate(zip(STATES, rows, scales)):
        baseline = max(pose["bbox"][3] for pose in poses)
        for column, pose in enumerate(poses):
            left, top, right, bottom = pose["bbox"]
            cropped = pose["image"].crop(pose["bbox"])
            cropped = cropped.resize((round((right-left)*scale), round((bottom-top)*scale)), Image.Resampling.LANCZOS)
            x = round((192-cropped.width)/2)
            y = round(198 - (baseline-top)*scale)
            if x < 4 or y < 4 or x+cropped.width > 188 or y+cropped.height > 204:
                raise ValueError(f"{name}/{column}: pose cannot fit without clipping: {x,y,cropped.size}")
            cell = Image.new("RGBA", (192, 208))
            cell.alpha_composite(cropped, (x, y))
            # Clear hidden RGB so encoders and compositors cannot expose fringes.
            pixels = np.array(cell)
            pixels[pixels[:, :, 3] == 0] = 0
            cell = Image.fromarray(pixels)
            atlas.alpha_composite(cell, (column*192, row_index*208))
            metrics.append({"state": name, "frame": column, "bounds": cell.getbbox(),
                            "pixels": int(np.count_nonzero(pixels[:, :, 3])), "scale": scale})
    save_atlas(atlas, OUTPUT)
    # Hash the actual shipped bytes; every regeneration invalidates old QA.
    report = {"schema": 2, "width": 1536, "height": 2288, "cell": [192, 208],
              "requiredFrames": 73, "unusedCells": 15, "frames": metrics,
              "sha256": {name: hashlib.sha256((OUTPUT/name).read_bytes()).hexdigest()
                         for name in ["otto-v2.png", "otto-v2.webp"]},
              "sources": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(SOURCE.glob("*.png"))}}
    (ROOT / "brand/otto/atlas-build.json").write_text(json.dumps(report, indent=2) + "\n")
    # Inspect at native cell size, on a high-contrast neutral background.
    contact = Image.new("RGBA", atlas.size, "#343b38")
    contact.alpha_composite(atlas)
    contact.convert("RGB").save(ROOT / "brand/otto/contact-sheet.jpg", quality=90)
    for row, (name, count) in enumerate(STATES[:9]):
        frames = [atlas.crop((col*192, row*208, (col+1)*192, (row+1)*208)) for col in range(count)]
        # GIF is a review artifact only; production uses the lossless atlas.
        frames[0].save(ROOT / f"brand/otto/{name}.gif", save_all=True, append_images=frames[1:],
                       duration=140, loop=0, disposal=2)
    print(f"Built {len(metrics)} frames; PNG {(OUTPUT/'otto-v2.png').stat().st_size} bytes")


if __name__ == "__main__":
    build()
