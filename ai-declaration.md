# AI declaration

How AI (Claude Code) was used to build CertShell. Levels: Hint, Assisted, Pair, Generated.

| Area | Level | Notes |
|---|---|---|
| Design | Assisted | Architecture and threat model are mine; AI suggested refinements. |
| Implementation | Pair | AI wrote most of the code from my instructions; I edit it. |
| Testing | Pair | Tests written by both me and AI. I use CertShell daily on my own hosts. |
| Documentation | Generated | AI-written, lightly reviewed by me. |
| Review | Pair | I read every diff; AI review and CodeQL as extra passes. Security-critical paths (cert signing, auth, enrollment) reviewed line by line. |
| Deployment | Generated | Dockerfile, compose, CI and release workflows AI-written, lightly reviewed by me. |
