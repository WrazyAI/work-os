import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { TUTORIALS } from "../src/modules/work-os/tutorials.ts";

test("all eleven published tutorials carry their complete interactive film", () => {
  assert.equal(TUTORIALS.length, 11);
  assert.equal(new Set(TUTORIALS.map((lesson) => lesson.slug)).size, 11);
  for (const lesson of TUTORIALS) {
    assert.equal(lesson.status, "published");
    assert.ok(lesson.video && lesson.poster && lesson.captions);
    const probe = JSON.parse(execFileSync("ffprobe", [
      "-v", "error", "-count_frames", "-show_entries",
      "stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames:format=duration",
      "-of", "json", `public${lesson.video}`,
    ], { encoding: "utf8" }));
    const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
    const audio = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
    assert.equal(video.codec_name, "h264", lesson.slug);
    assert.equal(video.r_frame_rate, "60/1", lesson.slug);
    assert.equal(video.width, 1440, lesson.slug);
    assert.equal(video.height, 900, lesson.slug);
    assert.equal(audio.codec_name, "aac", lesson.slug);
    const duration = Number(probe.format.duration);
    assert.ok(lesson.slug === "otto-extended" ? duration >= 180 && duration < 420 : duration >= 30 && duration < 80, `${lesson.slug}: complete interactive film`);
    assert.ok(Math.abs(duration - lesson.duration!) < .002, `${lesson.slug}: exact manifest duration`);
    assert.ok(Math.abs(Number(video.nb_read_frames) - duration * 60) < 1, `${lesson.slug}: complete constant-rate stream`);
    assert.equal(readFileSync(`public${lesson.poster}`).subarray(0, 2).toString("hex"), "ffd8", lesson.slug);
    const captions = readFileSync(`public${lesson.captions}`, "utf8");
    assert.match(captions, /^WEBVTT/);
    const positions = new Set([...captions.matchAll(/line:([^ ]+) position:([^ ]+)/g)].map((match) => `${match[1]}:${match[2]}`));
    assert.ok(positions.size >= 2, `${lesson.slug}: scene-aware captions`);
    assert.ok(lesson.steps.length >= 3, lesson.slug);
    if (lesson.slug === "otto-extended") {
      assert.equal(lesson.chapters?.length, 8);
      assert.equal(lesson.chapters![0].start, 0);
      for (const [index, chapter] of lesson.chapters!.entries()) {
        assert.ok(chapter.start >= 0 && chapter.start < duration);
        assert.ok(index === 0 || chapter.start > lesson.chapters![index - 1].start);
      }
    }
  }
});
