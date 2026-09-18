# Commit Message Convention

Use the following format:

```text
type(scope): description
```

## Types

- `feat`: Add a feature
- `fix`: Fix a bug
- `docs`: Update documentation
- `refactor`: Restructure code without changing behavior
- `test`: Add or update tests
- `chore`: Update tooling, dependencies, or configuration

## Guidelines

- Use a short, imperative description.
- Keep each commit focused on one change.
- Use a concise scope such as `frontend`, `backend`, or `root`.

Example:

```text
feat(frontend): add login form
```

# Branch Naming Convention

Use the following format:

```text
type/scope/short-description
```

Use the same types and scopes as the commit message convention. Write descriptions in lowercase and separate words with hyphens.

## Guidelines

- Keep the name short and descriptive.
- Create one branch for one focused change.
- Do not use spaces or special characters.
- Delete the branch after it is merged.

Example:

```text
feat/frontend/add-login-form
fix/backend/token-expiration
```
