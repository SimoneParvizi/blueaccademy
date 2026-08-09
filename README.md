# blueaccademy

blueaccademy is an opensource learning platform for Kubernetes, Docker, Pulumi, and adjacent infrastructure workflows.

The project combines flashcards, guided terminal drills, CKAD-style validation, and
broader real-environment exercises.

## Status
#### Current status
blueaccademy started as a fast TypeScript prototype to validate the product direction. Currently, the backend is being
rewritten in Python/FastAPI to make the architecture more maintainable, while the frontend still
reflects prototype-era structure.

Right now, the flashcards section is the part that is stable and usable. After the initial automatic seed,
you can add custom cards and import existing Anki decks.

#### Supported now
The current supported slice is:

- deck create/edit/delete
- flashcard study and review flow
- persistence through the Python backend
- repo-managed seed data

#### In progress
The following areas are currently being migrated to the new Python structure:
- guided terminal exercises

#### Not yet supported
The following areas are not yet supported in this release, and PRs will not be accepted for the following areas:

- CKAD-style validation flows
- broader E2E / real-environment exercises
- chat and hosted sandbox orchestration


## Architecture
Right now the repo is split into:
- `frontend/` — React/Vite frontend
- `backend/app/` — FastAPI backend, schemas, services, and ORM models
- `backend/app/db/learning_content/` — repo-managed starter flashcard and deck content
- `infra/` — Dockerfiles and local Compose setup

The current runtime entrypoint is the Docker setup in `infra/`.
