"""
Build the Design Studio package: the app built for
https://designstudio.worldbank.org/regional-power-explorer/, zipped for the
server. Design Studio packages are built here, on a team machine, never by
GitHub.

    python tools/build_design_studio.py [--out DIR]

Steps:
  1. refuses to run with uncommitted changes to tracked files, so the zip is
     exactly the commit it is named after;
  2. lints the AI-assistant code, as the old CI build did;
  3. `npm run build` without VERCEL set, so the app is built for the
     /regional-power-explorer/ path (see vite.config.js);
  4. checks the bundle: the World Bank basemap and the assistant are in it, no
     runtime FeatureServer reference, no secret-shaped VITE_ variable;
  5. zips dist/ (files at the zip's root, as the server expects) to
     regional-power-explorer_design-studio_<date>_<commit>.zip, by default in
     the folder that holds the repository.

Runs from WSL too: npm is then the Windows one, through cmd.exe.
"""
import argparse
import datetime
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
LINT_PATHS = ["src/chat", "src/constants.js", "src/utils/basemap.js"]


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, check=True,
                          capture_output=True, text=True).stdout.strip()


def npm_command(args):
    """npm args as a command line for this machine: npm itself, or, in WSL
    without a Linux npm, the Windows one through cmd.exe."""
    if shutil.which("npm"):
        return ["npm", *args]
    if shutil.which("cmd.exe"):
        return ["cmd.exe", "/c", "npm " + " ".join(args)]
    sys.exit("npm not found")


def run_npm(args, env):
    subprocess.run(npm_command(args), cwd=ROOT, env=env, check=True)


def check_bundle():
    """The old CI smoke checks, over every built JS/CSS asset."""
    text = "\n".join(p.read_text(encoding="utf-8", errors="ignore")
                     for p in (DIST / "assets").rglob("*") if p.is_file())
    problems = []
    if "dcc1c1c0f97f4e458199888b0fc63896" not in text:
        problems.append("World Bank basemap style id missing")
    if "Power Explorer Assistant" not in text:
        problems.append("AI assistant missing")
    if "FeatureServer" in text:
        problems.append("runtime FeatureServer reference in the browser bundle")
    if re.search(r"VITE_[A-Z0-9_]*(API_KEY|SECRET|TOKEN)", text):
        problems.append("secret-shaped VITE_ variable in the browser bundle")
    if "/regional-power-explorer/assets/" not in (DIST / "index.html").read_text(encoding="utf-8"):
        problems.append("index.html not built for the /regional-power-explorer/ path")
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=ROOT.parent,
                    help="folder for the zip (default: the folder holding the repository)")
    args = ap.parse_args()

    if git("status", "--porcelain", "--untracked-files=no"):
        sys.exit("Uncommitted changes to tracked files; commit or stash them first, "
                 "so the zip matches the commit it is named after.")
    commit = git("rev-parse", "--short", "HEAD")
    name = f"regional-power-explorer_design-studio_{datetime.date.today():%Y-%m-%d}_{commit}.zip"

    env = {k: v for k, v in os.environ.items() if k != "VERCEL"}
    log("lint")
    run_npm(["exec", "--", "eslint", *LINT_PATHS], env)
    log("build")
    run_npm(["run", "build"], env)

    problems = check_bundle()
    if problems:
        sys.exit("Bundle checks failed:\n  " + "\n  ".join(problems))
    log("bundle checks passed")

    args.out.mkdir(parents=True, exist_ok=True)
    zip_path = args.out / name
    files = sorted(p for p in DIST.rglob("*") if p.is_file())
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(DIST).as_posix())
    log(f"{zip_path}  ({len(files)} files, {zip_path.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
