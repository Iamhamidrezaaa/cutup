# Agent Office (upstream clone target)

This directory should contain a **vanilla clone** of:

**https://github.com/harishkotra/agent-office**

If you still see only this file, populate the folder from `instalogist`:

```powershell
cd instalogist
Remove-Item -Recurse -Force agent-office
git clone https://github.com/harishkotra/agent-office.git agent-office
```

Full setup (env, ports, build, troubleshooting):

**`docs/architecture/instalogist-agent-office-bootstrap.md`**

---

**Instalogist scope:** isolated UI experiment only — **no** link to `operational-state.json`, CutUp admin, or production deploy in this phase.
