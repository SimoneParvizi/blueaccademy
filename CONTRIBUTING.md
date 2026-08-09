# Contributing

Contributions are welcome across code, documentation, bug reports, and product
feedback. Whether this is your first open source contribution or you maintain
multiple projects already, your time and attention are appreciated.

## Before you start

Read these first:

- [README.md](README.md) for the current product scope and local runtime
- The public docs site for deeper documentation as it expands

This repository is still in an active transition from an earlier prototype to a
more maintainable Python/FastAPI architecture. That matters because not every
area of the product is open for contributions yet.

## What is in scope currently

Contributions are currently most useful in these areas:

- Flashcards and deck workflows
- Python backend improvements
- Frontend improvements that match the current product scope
- Documentation and local developer experience
- Bug fixes and test coverage

These areas are not yet open for feature contributions in this repo:

- CKAD-style validation flows
- Broader E2E or real-environment exercises
- Chat and hosted sandbox orchestration

If you are unsure whether a change is a good fit, open an issue first.

## Development docs

Detailed project documentation is being maintained separately from this code
repository.

- Public docs: `https://docks.blueaccademy.com/`
- Documentation index: `https://docks.blueaccademy.com/llms.txt`
- Docs repository: `https://github.com/SimoneParvizi/blueaccademy-docs`

Use this repository for contribution workflow and repo-specific expectations.
Use the docs site and docs repo for deeper implementation and product
documentation as it grows.

## Discuss larger changes first

As a practical rule:

- If a change is tiny, such as a typo, copy tweak, or small isolated fix, you
  can usually open a pull request directly.
- If a change is larger than a small isolated fix, open an issue first so we
  can confirm fit, scope, and direction before you spend time building it.

This is mainly to avoid wasted effort. A technically valid change can still be a
bad fit for the current roadmap.

## Types of contributions

Useful contributions include:

- Bug fixes
- Tests
- Documentation improvements
- Small UX improvements
- Focused refactors
- Developer tooling improvements
- Issue reports and feature proposals

## AI-assisted contributions

AI-assisted work is allowed, but the submitter is still fully responsible for
the result.

If you use AI tools, make sure you:

- Understand every change you submit
- Verify correctness yourself
- Match the architecture and conventions of this repo
- Do not submit large speculative rewrites

Pull requests that look unreviewed, low-signal, or mechanically generated may
be closed without merge.

## Branch naming

Use one of these branch prefixes:

- `chore/` for maintenance and small adjustments
- `feat/` for new features
- `fix/` for bug fixes
- `exp/` for experiments or analysis that are not intended to be merged into
  `main`

Examples:

```bash
git checkout -b feat/my-new-feature
git checkout -b fix/review-scheduler-bug
git checkout -b chore/update-seed-data
```

Keep branch names descriptive and scoped to one piece of work.

## How to contribute

This project follows a fork and pull request workflow.

1. Fork the repository on GitHub.
2. Clone your fork locally.

```bash
git clone https://github.com/YOUR_USERNAME/blueaccademy.git
cd blueaccademy
```

3. Create a branch using the naming rules above.

```bash
git checkout -b feat/your-change
```

4. Make your changes.
5. Add or update tests when the change affects behavior.
6. Run the relevant local checks before opening a pull request.
7. Push your branch and open a pull request against `main`.

```bash
git push --set-upstream origin feat/your-change
```

Optional quality-of-life setup:

```bash
git config --global push.autoSetupRemote true
```

That saves you from repeating `--set-upstream` for each new branch.

## Pull request expectations

A good pull request should:

- Explain what changed
- Explain why the change is needed
- Stay focused on one concern
- Include tests when behavior changes
- Avoid unrelated cleanup

If your change is user-facing, include screenshots or a short explanation of the
before and after behavior when useful.

## Code style expectations

Contributors are expected to follow the conventions reflected in the current
codebase:

- Keep solutions simple
- Prefer readability over cleverness
- Avoid speculative abstractions
- Keep frontend and backend boundaries explicit
- Fix contracts instead of adding compatibility hacks

## Need help?

If something is unclear, start with an issue. That is the best place to confirm
whether a contribution fits the current direction of the project.
