FROM ghcr.io/astral-sh/uv:python3.12-alpine@sha256:3f6697770ce4665f7064c55b12380699b33cd017cc331fb9c1566fb4bc35931e

COPY ./pyproject.toml uv.lock /
COPY ./backend/ /backend

RUN uv sync --locked

CMD ["uv", "run", "fastapi", "run", "--host", "0.0.0.0", "--port", "8000"]