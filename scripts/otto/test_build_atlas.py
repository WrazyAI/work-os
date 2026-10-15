import unittest
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw
from build_atlas import extract_poses, save_atlas


class ComponentExtractionTests(unittest.TestCase):
    def test_recovers_unevenly_spaced_poses_and_discards_specks(self):
        image = Image.new("RGBA", (400, 150))
        draw = ImageDraw.Draw(image)
        draw.rectangle((10, 15, 80, 140), fill="white")
        draw.rectangle((230, 15, 300, 140), fill="white")
        draw.point((150, 30), fill="white")
        poses = extract_poses(image, 2)
        self.assertEqual(len(poses), 2)
        self.assertEqual(poses[0]["bbox"], (10, 15, 81, 141))
        self.assertEqual(poses[1]["bbox"], (230, 15, 301, 141))

    def test_rejects_a_missing_pose_instead_of_accepting_a_speck(self):
        image = Image.new("RGBA", (400, 150))
        ImageDraw.Draw(image).rectangle((10, 15, 80, 140), fill="white")
        with self.assertRaises(ValueError):
            extract_poses(image, 2)

    def test_webp_preserves_cleared_transparent_rgb_bytes(self):
        # A flat white rectangle does not trigger libwebp's hidden-color
        # prediction; use a real antialiased character boundary.
        source = Path(__file__).resolve().parents[2] / "desktop/work-os-companion/public/otto/otto-v2.png"
        image = Image.open(source).convert("RGBA").crop((0, 0, 192, 208))
        with tempfile.TemporaryDirectory() as directory:
            save_atlas(image, Path(directory))
            decoded = Image.open(Path(directory) / "otto-v2.webp").convert("RGBA")
            self.assertEqual(decoded.tobytes(), image.tobytes())


if __name__ == "__main__":
    unittest.main()
