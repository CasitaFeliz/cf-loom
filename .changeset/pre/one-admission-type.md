---
"@cf-loom/handlers": major
---

`CheckedAdmission` is removed: a GuardHandler's Direct call returns `Admission<typeof apiKey>`, the type its implementation builds, which `CheckedAdmission` always equalled. Code that names `CheckedAdmission` names `Admission` instead; nothing changes at run time.
