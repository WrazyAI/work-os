#!/usr/bin/env node
/**
 * render-tutorial-remote.mjs
 *
 * Finish a tutorial film on the Work OS VPS: encode the captured frames,
 * normalise the soundtrack, build the poster and contact sheet, and pull every
 * derived asset back. The live desktop capture stays local because its UI runs
 * in an offline localhost fixture; everything after that is file-based and can
 * run on the VPS.
 *
 * Credentials never live in this repository. Set:
 *   WORK_OS_RENDER_HOST   dev@<vps-host>
 *   WORK_OS_RENDER_KEY    /path/to/private/key
 * Optional:
 *   WORK_OS_RENDER_DIR    remote scratch root (default /tmp/work-os-render)
 *
 * Usage:
 *   node scripts/render-tutorial-remote.mjs \
 *     --video .work/silent.mp4 --music .work/music.wav \
 *     --slug eod-desktop --out-dir public/work-os/tutorials
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const video = flag("video");
const music = flag("music");
const slug = flag("slug");
const outDir = resolve(flag("out-dir", "public/work-os/tutorials"));
const fps = Number(flag("fps", "60"));
const crf = Number(flag("crf", "20"));
const loudness = flag("loudness", "-16");
const host = process.env.WORK_OS_RENDER_HOST;
const key = process.env.WORK_OS_RENDER_KEY;
const remoteRoot = process.env.WORK_OS_RENDER_DIR || "/tmp/work-os-render";

if (!video || !music || !slug) {
  console.error("Usage: render-tutorial-remote.mjs --video <mp4> --music <wav> --slug <name> [--out-dir <dir>]");
  process.exit(2);
}
if (!host || !key) {
  console.error("Set WORK_OS_RENDER_HOST and WORK_OS_RENDER_KEY (credentials are never committed).");
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) {
  console.error("slug must be lowercase letters, digits and hyphens");
  process.exit(2);
}
for (const file of [video, music]) {
  if (!existsSync(file)) {
    console.error(`missing input: ${file}`);
    process.exit(2);
  }
}

const sshArgs = ["-i", key, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host];
const remoteDir = `${remoteRoot}/${slug}-${process.pid}`;
const movie = `${remoteDir}/${slug}.mp4`;
const poster = `${remoteDir}/${slug}.jpg`;
const contact = `${remoteDir}/${slug}-contact.jpg`;
const ssh = (command) => execFileSync("ssh", [...sshArgs, command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const rsyncDown = (from, to) => execFileSync("rsync", ["-az", "-e", `ssh -i ${key} -o BatchMode=yes`, `${host}:${from}`, to], { stdio: "inherit" });
const rsyncUp = (from, to) => execFileSync("rsync", ["-az", "-e", `ssh -i ${key} -o BatchMode=yes`, from, `${host}:${to}`], { stdio: "inherit" });

mkdirSync(outDir, { recursive: true });
const downloaded = [video, music, ...(flag("extra") ? flag("extra").split(",") : [])]
  .filter((file) => existsSync(file));

let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  try { ssh(`rm -rf ${remoteDir}`); } catch { /* scratch cleanup is best-effort */ }
};
process.on("exit", cleanup);

try {
  ssh(`mkdir -p ${remoteDir}`);
  for (const file of downloaded) rsyncUp(file, `${remoteDir}/`);

  const videoName = basename(video);
  const musicName = basename(music);
  const command = [
    "set -euo pipefail",
    `cd ${remoteDir}`,
    `ffmpeg -y -v error -i ${videoName} -i ${musicName} ` +
      `-map 0:v:0 -map 1:a:0 -c:v libx264 -preset slow -crf ${crf} -r ${fps} -pix_fmt yuv420p -g ${fps * 2} ` +
      `-c:a aac -b:a 160k -ar 48000 -af loudnorm=I=${loudness}:TP=-2:LRA=6 ` +
      `-movflags +faststart -shortest ${slug}.mp4`,
    `ffmpeg -y -v error -ss 0 -i ${slug}.mp4 -frames:v 1 -q:v 3 ${slug}.jpg`,
    `ffmpeg -y -v error -i ${slug}.mp4 -vf "select='not(mod(n,${fps * 3}))',scale=900:-1,tile=2x4" -frames:v 1 ${slug}-contact.jpg`,
    `ffprobe -v error -count_frames -show_entries stream=codec_name,codec_type,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,sample_rate,channels:format=duration,size -of json ${slug}.mp4`,
  ].join(" && ");
  const remoteOutput = ssh(command);
  const jsonStart = remoteOutput.indexOf("{");
  const remoteProbe = JSON.parse(remoteOutput.slice(jsonStart).trim());

  rsyncDown(movie, `${outDir}/${slug}.mp4`);
  rsyncDown(poster, `${outDir}/${slug}.jpg`);
  rsyncDown(contact, `${outDir}/${slug}-contact.jpg`);

  const localProbe = JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-count_frames",
    "-show_entries", "stream=codec_name,codec_type,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,sample_rate,channels:format=duration,size",
    "-of", "json", `${outDir}/${slug}.mp4`,
  ], { encoding: "utf8" }));
  const localVideo = localProbe.streams.find((stream) => stream.codec_type === "video");
  const localAudio = localProbe.streams.find((stream) => stream.codec_type === "audio");
  if (!localVideo || localVideo.r_frame_rate !== `${fps}/1`) throw new Error("remote output did not keep the requested frame rate");
  if (!localAudio || localAudio.codec_name !== "aac") throw new Error("remote output has no AAC soundtrack");

  const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const report = {
    result: "PASS",
    hostClass: "work-os-render-vps",
    slug,
    fps,
    remoteProbe,
    localProbe,
    bytes: statSync(`${outDir}/${slug}.mp4`).size,
    sha256: digest(`${outDir}/${slug}.mp4`),
    outDir: dirname(`${outDir}/${slug}.mp4`),
    cleanup: "remote scratch removed",
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  cleanup();
}
