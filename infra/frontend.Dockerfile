FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

COPY ./frontend /app/

WORKDIR /app

ENV VITE_PYTHON_API_BASE_URL=http://localhost:8000

RUN npm ci

CMD ["npx", "vite", "--host", "0.0.0.0"]