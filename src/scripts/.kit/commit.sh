#!/usr/bin/env bash
# D9: the one commit entry. Only named files; serialize Git's shared files.
# Usage: src/scripts/.kit/commit.sh [--patch file.patch] "message" -- files...
set -euo pipefail
[ -z "${GIT_INDEX_FILE:-}" ] || { echo 'commit.sh: private indexes are retired' >&2; exit 2; }
patch=''
if [ "${1:-}" = --patch ]; then
  [ "$#" -ge 5 ] || { echo 'usage: commit.sh --patch file.patch "message" -- <files...>' >&2; exit 2; }
  patch="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
  [ -r "$patch" ] || { echo "commit.sh: unreadable patch: $patch" >&2; exit 2; }
  shift 2
fi
[ "$#" -ge 3 ] && [ "$2" = -- ] || { echo 'usage: src/scripts/.kit/commit.sh "message" -- <files...>' >&2; exit 2; }
message=$1; shift 2
cd "$(git rev-parse --show-toplevel)"
for path in "$@"; do
  case "$path" in .|:/|/*|../*|*:*|*\**|*\?*|*\[*) echo "commit.sh: name literal repository files: $path" >&2; exit 2 ;; esac
  [ ! -d "$path" ] || { echo "commit.sh: name files, not directories: $path" >&2; exit 2; }
done
common="$(git rev-parse --path-format=absolute --git-common-dir)"
# This checkout's own index: a linked worktree (J240) has its own, never the common dir's (DS6).
index="$(git rev-parse --path-format=absolute --git-path index)"
# Advance untouched parent copies under the commit lock; stages use the index lock.
align_shared_index() {
  python3 - "$@" <<'PYALIGN'
import os, subprocess, sys
from pathlib import Path
common, index, parent, landed, *paths = sys.argv[1:]
env = dict(os.environ)
env.pop("GIT_INDEX_FILE", None)
def git(*args, **kwargs):
    return subprocess.check_output(["git", *args], env=env, **kwargs)
def tree(revision):
    return {path: mode + b" " + oid + b" 0" for record in git("ls-tree", "-rz", revision, "--", *paths).split(b"\0") if record
            for metadata, path in [record.split(b"\t", 1)] for mode, _, oid in [metadata.split()]}
before, after = tree(parent), tree(landed)
def contents(row):
    return None if row is None else git("cat-file", "blob", row.split()[1].decode())
def working(path):
    if path.is_symlink() or any(part.is_symlink() for part in path.parents):
        raise ValueError("symlink path")
    if not path.exists():
        return None
    if not path.is_file():
        raise ValueError("non-file path")
    return path.read_bytes()
advanced = 0
for name in paths:
    key, path = os.fsencode(name), Path(name)
    previous, current = before.get(key), after.get(key)
    if previous == current:
        continue
    temporary = None
    try:
        if any(row is not None and row.split()[0] not in (b"100644", b"100755") for row in (previous, current)):
            raise ValueError("unsupported Git mode")
        expected, desired = contents(previous), contents(current)
        actual = working(path)
        if actual == desired and (current is None or path.stat().st_mode & 0o777 == (0o755 if current.split()[0] == b"100755" else 0o644)):
            continue
        if actual != expected:
            raise ValueError("local edits")
        if desired is None:
            # Recheck immediately before changing this exact declared path.
            if working(path) != expected:
                raise ValueError("concurrent edits")
            path.unlink()
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            import tempfile
            descriptor, temporary = tempfile.mkstemp(prefix=".commit-next-", dir=path.parent)
            with os.fdopen(descriptor, "wb") as output:
                output.write(desired)
            os.chmod(temporary, 0o755 if current.split()[0] == b"100755" else 0o644)
            if working(path) != expected:
                raise ValueError("concurrent edits")
            os.replace(temporary, path)
        advanced += 1
    except (OSError, ValueError) as error:
        print(f"commit.sh: preserve working edits: {name} ({error})", file=sys.stderr)
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)
if advanced:
    print(f"commit.sh: advanced {advanced} untouched working paths")
index = Path(index)
lock = Path(str(index) + ".lock")
try:
    handle = lock.open("xb")
except FileExistsError:
    print("commit.sh: shared index busy; committed patch left unchanged", file=sys.stderr)
    raise SystemExit(0)
try:
    with handle:
        handle.write(index.read_bytes())
    env["GIT_INDEX_FILE"] = str(lock)
    staged = {}
    for record in git("ls-files", "--stage", "-z", "--", *paths).split(b"\0"):
        if record:
            metadata, path = record.split(b"\t", 1)
            staged.setdefault(path, []).append(metadata)
    # Intent-to-add has no staged delta against an absent parent path. Advance
    # that owned entry without overwriting a real foreign staged addition.
    staged_changes = set(git("diff", "--cached", "--ita-invisible-in-index", "--name-only", "-z", parent, "--", *paths).split(b"\0"))
    updates = []
    for name in paths:
        path = os.fsencode(name)
        if staged.get(path, []) != ([] if path not in before else [before[path]]) and not (path not in before and path not in staged_changes):
            continue
        row = after.get(path, b"0 " + b"0" * 40 + b" 0")
        updates.append(row + b"\t" + path + b"\0")
    if updates:
        git("update-index", "-z", "--index-info", input=b"".join(updates))
        os.replace(lock, index)
finally:
    lock.unlink(missing_ok=True)
PYALIGN
}
export -f align_shared_index
# Generate from immutable candidate inputs. Freshness checks, installed Git
# hooks and index alignment hold the shared commit lease.
exec python3 - "$common" "$index" "$message" "$patch" "$@" <<'PYCOMMIT'
import fcntl, hashlib, json, os, runpy, shutil, signal, subprocess, sys, tempfile, time
from pathlib import Path
common, own_index, message, patch, *paths = sys.argv[1:]
started = time.monotonic()
source_seconds = 0.0
waiting = acquired = released = None
handoffs = []
budget_started_ms = int(time.time() * 1000)
os.environ["WS_COMMIT_STARTED_AT"] = str(budget_started_ms)
os.environ["WS_COMMIT_MESSAGE"] = message
os.environ["WS_COMMIT_WRAPPER"] = "1"
base_env = dict(os.environ)
def git(*args, env=None, **kwargs):
    return subprocess.check_output(["git", *args], env=env or base_env, **kwargs)
def refuse(message):
    raise SystemExit("commit.sh: " + message)
def timeout(*_):
    refuse("commit lock timed out")
try:
    # Use this repository's installed message policy before generating inputs,
    # taking the shared lease or running an expensive hook. Do not duplicate it.
    javascript_validator = Path(".githooks/check-commit-message.mjs")
    validator = ".githooks/commit-msg-conventions"
    if javascript_validator.is_file():
        check = subprocess.run(["node", "--input-type=module", "-e",
            "import {readFileSync} from 'node:fs';"
            "const {validate}=await import(process.argv[1]);"
            "const error=validate(readFileSync(0,'utf8'),{human:process.env.SKIP_ATTRIB==='1'});"
            "if(error){console.error(error);process.exitCode=1;}",
            javascript_validator.resolve().as_uri()], input=message, text=True,
            capture_output=True, timeout=5, env=base_env)
        if check.returncode:
            refuse(check.stderr.strip() or "message policy refused")
    elif os.path.isfile(validator):
        error = runpy.run_path(validator)["validate"](message, human=os.getenv("SKIP_ATTRIB") == "1")
        if error:
            refuse(error)
    with tempfile.TemporaryDirectory(prefix="commit-patch.", dir=common) as temporary:
        scratch = Path(temporary)
        parent = git("rev-parse", "HEAD").decode().strip()
        index = scratch / "index"
        shutil.copy2(own_index, index)
        candidate_env = {**base_env, "GIT_INDEX_FILE": str(index)}
        git("read-tree", "--reset", parent, env=candidate_env)
        entries = git("ls-files", "-z", env=candidate_env)
        for flag in ["--no-assume-unchanged", "--no-skip-worktree", "--no-fsmonitor-valid"]:
            git("update-index", flag, "-z", "--stdin", input=entries, env=candidate_env)
        # Regeneration reads the checked candidate, including semantic patches,
        # rather than another lane's loose input or output bytes.
        if patch:
            git("apply", "--cached", "--", patch, env=candidate_env)
        else:
            git("add", "-A", "--", *paths, env=candidate_env)
        # GS4 (G798): a named input of a committed gen:source table regenerates that table, which joins the commit,
        # so an input never lands without its output. It runs before the hook, before the installed hooks.
        regenerated = []
        if os.path.isfile("scripts/gen-source.mjs"):
            source_started = time.monotonic()
            source_tree = git("write-tree", env=candidate_env).decode().strip()
            stage = subprocess.run(["node", "scripts/committed-source-tables.mjs", "--tree=" + source_tree,
                *["--changed=" + name for name in paths]], env=base_env, capture_output=True, text=True)
            lines = [row for row in stage.stdout.splitlines() if row.startswith("gen:source texts ")]
            if stage.returncode or not lines:
                refuse("gen:source could not regenerate the tables these paths feed:\n" + stage.stderr[-2000:])
            texts = json.loads(lines[-1][len("gen:source texts "):])
            if not isinstance(texts, dict) or any(not isinstance(name, str) or not isinstance(text, str)
                    for name, text in texts.items()):
                refuse("gen:source must return owned source text")
            for name in texts:
                if not name or name.startswith("/") or "\\" in name or ":" in name or any(part in ("", ".", "..") for part in name.split("/")):
                    refuse("invalid generated source path: " + name)
            if texts:
                # Preserve git add's ignored-new-file refusal without writing
                # canonical output over a peer's loose copy just to stage it.
                ignored = subprocess.run(["git", "check-ignore", "-z", "--stdin"], env=candidate_env,
                    input=b"".join(os.fsencode(name) + b"\0" for name in texts), capture_output=True)
                if ignored.returncode not in (0, 1):
                    refuse("cannot check generated source ignores: " + os.fsdecode(ignored.stderr))
                if ignored.stdout:
                    refuse("generated sources are ignored: " + ", ".join(os.fsdecode(name)
                        for name in ignored.stdout.split(b"\0") if name))
            updates = []
            for name, text in texts.items():
                oid = git("hash-object", "-w", "--stdin", input=text.encode(), env=candidate_env).strip()
                updates.append(b"100644 " + oid + b"\t" + os.fsencode(name) + b"\0")
            if updates:
                git("update-index", "-z", "--index-info", input=b"".join(updates), env=candidate_env)
            regenerated = [name for name in texts if name not in paths]
            paths += regenerated
            if regenerated:
                print("commit.sh: gen:source tables join the commit: " + ", ".join(regenerated), flush=True)
            if texts:
                # G798 exempts only source generation/staging, not ordinary
                # checks. Keep the full wall clock while preserving their 5 s.
                source_seconds = time.monotonic() - source_started
                budget_start = str(budget_started_ms + int(source_seconds * 1000))
                os.environ["WS_COMMIT_STARTED_AT"] = budget_start
                base_env["WS_COMMIT_STARTED_AT"] = budget_start
                candidate_env["WS_COMMIT_STARTED_AT"] = budget_start
        staged = git("ls-files", "--stage", "-z", "--", *paths).hex()
        # Freeze working bytes before staging; Git must stage precisely that view.
        def working(name):
            path = Path(name)
            if path.is_symlink():
                return ["symlink", os.readlink(path)]
            if not path.exists():
                return None
            return [path.stat().st_mode & 0o777, hashlib.sha256(path.read_bytes()).hexdigest()]
        working_inputs = {name: working(name) for name in paths}
        changed = git("diff", "--cached", "--name-only", "--no-renames", "-z", parent, env=candidate_env).split(b"\0")
        for name in changed:
            if name and os.fsdecode(name) not in paths:
                refuse("candidate changes undeclared path: " + os.fsdecode(name))
        tree = git("write-tree", env=candidate_env).decode().strip()
        hooks = Path(git("rev-parse", "--path-format=absolute", "--git-path", "hooks").decode().strip())
        hook_files = {file.name: [file.stat().st_mode & 0o777, hashlib.sha256(file.read_bytes()).hexdigest()]
                      for file in hooks.iterdir() if file.is_file()} if hooks.is_dir() else {}
        # Engine's main-only guard must see the real checkout. Git runs all
        # installed hooks normally against this immutable candidate index.
        signal.signal(signal.SIGALRM, timeout)
        signal.alarm(120)
        with open(Path(common) / "commit.lock", "a") as lease:
            print("commit.sh: waiting for commit lock", flush=True)
            waiting = time.monotonic()
            fcntl.flock(lease, fcntl.LOCK_EX)
            acquired = time.monotonic()
            signal.alarm(0)
            try:
                latest = git("rev-parse", "HEAD").decode().strip()
                if latest != parent:
                    inputs = set(paths)
                    moved = {os.fsdecode(name) for name in git("diff", "--name-only", "--no-renames", "-z", parent, latest).split(b"\0") if name}
                    overlap = sorted(moved & inputs)
                    if overlap:
                        refuse("checked inputs changed: " + ", ".join(overlap[:8]) + "; rerun against fresh inputs")
                    delta = git("diff", "--binary", "--no-renames", parent, tree)
                    git("read-tree", "--reset", latest, env=candidate_env)
                    git("apply", "--cached", "--binary", "-", input=delta, env=candidate_env)
                    print("commit.sh: fresh inputs; retain disjoint peer commits", flush=True)
                current_hooks = {file.name: [file.stat().st_mode & 0o777, hashlib.sha256(file.read_bytes()).hexdigest()]
                                 for file in hooks.iterdir() if file.is_file()} if hooks.is_dir() else {}
                if current_hooks != hook_files:
                    refuse("hook source changed during source generation; rerun")
                if git("ls-files", "--stage", "-z", "--", *paths).hex() != staged:
                    refuse("named stages changed during source generation; rerun")
                if {name: working(name) for name in paths} != working_inputs:
                    refuse("named working inputs changed during source generation; rerun")
                result = subprocess.run(["git", "commit", "-q", "-m", message], env=candidate_env)
                if result.returncode:
                    raise SystemExit(result.returncode)
                landed = git("rev-parse", "HEAD").decode().strip()
                subprocess.run(["bash", "-c", 'align_shared_index "$@"', "commit.sh", common, own_index, parent, landed, *paths], env=base_env, check=True)
            finally:
                released = time.monotonic()
        raise SystemExit(0)
except subprocess.CalledProcessError as error:
    raise SystemExit(error.returncode)
finally:
    finished = time.monotonic()
    elapsed = (finished - started) * 1000
    wait = 0 if waiting is None else ((finished if acquired is None else acquired) - waiting) * 1000
    hold = 0 if acquired is None else ((released or finished) - acquired) * 1000
    work = elapsed - wait
    print(f"commit.sh: {wait:.0f} ms lock wait; {hold:.0f} ms lock held; {work - hold:.0f} ms outside lock", flush=True)
    print(f"commit.sh: {elapsed:.0f} ms total wall (lock wait included)", flush=True)
    if source_seconds:
        print(f"commit.sh: {source_seconds * 1000:.0f} ms G798 source work outside hook timing", flush=True)
    exception = sys.exc_info()[1]
    code = exception.code if isinstance(exception, SystemExit) else None
    code = code if code is None or isinstance(code, int) else 1
    timing = {"version": 1, "id": str(os.getpid()) + ":" + str(budget_started_ms),
              "at": time.time(), "elapsedMs": round(elapsed), "waitMs": round(wait),
              "workMs": round(work), "lockMs": round(hold), "exitCode": code,
              "gateDeferred": handoffs, "sourceMs": round(source_seconds * 1000),
              "lane": os.getenv("WS_COMMIT_LANE") or os.getenv("HC_TERMINAL_ID")}
    try:
        with open(Path(common) / "commit-times.jsonl", "a") as ledger:
            ledger.write(json.dumps(timing, separators=(",", ":")) + "\n")
    except OSError as error:
        print("commit.sh: timing log unavailable: " + str(error), file=sys.stderr)
    if elapsed - source_seconds * 1000 > 5000:
        print("commit.sh: source-excluded work exceeded five seconds", file=sys.stderr)
PYCOMMIT
