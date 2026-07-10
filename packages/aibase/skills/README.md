# Aibase Skills

Put project-local opencode skills here.

Each skill should live in its own folder with a `SKILL.md` file:

```text
skills/
  my-skill/
    SKILL.md
```

`src/server.mjs` starts opencode with:

```json
{
  "skills": {
    "paths": ["./skills"]
  }
}
```

The path is resolved to this project's absolute `skills/` directory at runtime.
