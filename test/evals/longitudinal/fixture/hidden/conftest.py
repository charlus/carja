import json, os, subprocess, sys
import pytest

REPO = os.environ["LB_REPO"]
PY = os.environ.get("LB_PYTHON", sys.executable)


class RB:
    def __init__(self, data):
        self.data = data

    def __call__(self, *args, now=None):
        env = {k: v for k, v in os.environ.items() if not k.startswith("ROOMBOOK_")}
        env["ROOMBOOK_DATA"] = str(self.data)
        if now:
            env["ROOMBOOK_NOW"] = now
        p = subprocess.run([PY, "-m", "roombook", *args], cwd=REPO, env=env, capture_output=True, text=True, timeout=30)
        out = None
        if p.returncode == 0:
            out = json.loads(p.stdout)
        return p.returncode, out

    def ok(self, *args, now=None):
        code, out = self(*args, now=now)
        assert code == 0, f"{args} exited {code}"
        return out


@pytest.fixture
def rb(tmp_path):
    return RB(tmp_path / "data")


@pytest.fixture
def room(rb):
    rb.ok("room", "add", "Alpha", "--capacity", "6")
    return rb
