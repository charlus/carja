# Carja Loop — Sandbox

> **Why this exists.** `carja loop` at autonomy **L3** runs an agent unattended
> with shell access. That is only safe inside a sandbox (survey §5). The driver
> **refuses L3 unless `loop-state.json` has an isolating `sandbox`** (terminal
> `halted_sandbox_required`). You do **not** build or maintain a container image —
> the sandbox is the agent CLI vendor's job.

## Two ways to satisfy the L3 gate

### 1. `"sandbox": "cli-native"` — recommended, no Docker

Use the agent CLI's **own, vendor-maintained** OS-level sandbox. Nothing for this
project (or you) to maintain but a host package.

- **`claude` (primary):** Anthropic's built-in **bubblewrap + socat** sandbox.
  Carja passes [`claude-sandbox.settings.json`](./claude-sandbox.settings.json)
  to each headless `claude -p` beat via `--settings` (it never touches your own
  `.claude/settings.json`). That profile sets `sandbox.enabled: true`,
  `failIfUnavailable: true` (fail-closed — a beat exits non-zero if the sandbox
  can't start, so an unsandboxed L3 run is impossible), `autoAllowBashIfSandboxed`
  (so headless bash runs without prompts), and a **network allowlist**.
  - **Host setup (one-time, no Docker):**
    ```bash
    sudo apt install -y bubblewrap socat      # Debian/Ubuntu (dnf on Fedora)
    # Ubuntu 24.04+: add the AppArmor profile for bwrap user namespaces
    # (see https://code.claude.com/docs/en/sandboxing).
    ```
  - **Before a real run, list YOUR git host and the other hosts a beat needs** in
    `carja.config.json` under `loop.allowed_domains`, e.g. `["code.example.com"]`.
    The loop merges them into a generated copy of this profile. Do not edit this
    file: `carja upgrade` replaces it. Everything not listed is blocked
    (default-deny egress).
  - **No package registry, ever.** A beat cannot reach PyPI, npm, crates.io,
    Maven Central or any other registry, and `loop.allowed_domains` refuses them.
    After a beat the driver reads the manifests it changed: a dependency the
    approved Technical Vision names is checked (it exists, pinned, old enough,
    not yanked, no known vulnerability in OSV) and installed with `loop.install`,
    outside the sandbox; any other is a question for the owner.
  - **Forge credentials are withheld.** Claude Code's sandbox has no built-in
    credential deny list: sandboxed commands read most of the home directory and
    inherit the environment. The profile denies `~/.ssh`, `~/.config/gh`,
    `~/.config/glab-cli`, the git credential files, and the cloud and container
    logins (`~/.config/gcloud`, `~/.aws`, `~/.azure`, `~/.kube`,
    `~/.docker/config.json`) to the shell
    (`sandbox.credentials`) and to Claude's Read tool (`permissions.deny`), and
    unsets `GH_TOKEN`, `GITHUB_TOKEN`, `GITLAB_TOKEN`, `SSH_AUTH_SOCK`, the
    keyring bus and the cloud credential variables (`GOOGLE_APPLICATION_CREDENTIALS`,
    `AWS_*`, `AZURE_CLIENT_SECRET`, `KUBECONFIG`). A beat cannot push or open a PR: the driver does both, from
    outside the sandbox. Put an SSH fetch of a private dependency in `loop.setup`.
  - **Headless beats run any sandboxed command.** A beat cannot answer a
    permission prompt, and Claude Code prompts for some sandboxed commands, such
    as one that starts with a variable assignment (`FOO=bar cmd`). The profile
    allows `Bash`, sets `allowUnsandboxedCommands: false` so that allow can never
    approve an unsandboxed retry (passed through `--settings`, this also makes the
    sandbox admin-required, so a repository's own settings cannot loosen it), and
    denies `git push`, `gh pr` and `glab mr`: only the driver pushes and opens PRs.
- **`agy` (Antigravity):** runs in **Google's hosted sandbox** — isolation is
  server-side and managed by Google; nothing to configure locally.
- **`codex`:** uses **OpenAI's** Docker-based sandbox; ensure your codex CLI is
  configured for a sandboxed mode.

Set in `carja/1-workbench/loop-state.json`:
```json
{ "autonomy_level": "L3", "sandbox": "cli-native", "concurrency": 4 }
```

### 2. `"sandbox": "container"` — BYO container (defence-in-depth / unsupported hosts)

For hosts where bubblewrap can't run, or if you want a second isolation layer,
run the whole loop inside a container **you** control. You still don't need to
*publish* an image — start from a trusted public base (e.g. the official `node`
image) and lock the network down at `docker run` time. `Dockerfile.sandbox` in
this directory is a minimal starting point:

```bash
docker build -f .agents/sandbox/Dockerfile.sandbox -t carja-loop .
docker run --rm -it \
  --network none \                 # or an allowlisted proxy for the model API + git host
  --cpus 2 --memory 4g \
  -v "$PWD:/work" -w /work \
  -e ANTHROPIC_API_KEY \
  carja-loop \
  carja loop --from-carja --unsafe-no-sandbox   # inside the container, this is honest
```

Then set `"sandbox": "container"` and `"autonomy_level": "L3"`.

## Levels below L3

L0–L2 (interactive, single-beat, or unattended *blueprint*) do not require a
sandbox — they keep a human on the loop or never touch a protected branch.
`sandbox: "none"` is fine there. A real `sandbox: "none"` run still requires the
operator to pass `--unsafe-no-sandbox` (asserting they've isolated it some other
way, e.g. a throwaway VM). The gate applies to L3 (unattended execution).
