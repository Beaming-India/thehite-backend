#!/bin/bash
set -e

# Load .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
fi

# Build DATABASE_URL from individual vars
if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi

echo "Connecting to: postgresql://${DB_USER}:****@${DB_HOST}:${DB_PORT}/${DB_NAME}"

cd db
DATABASE_URL="$DATABASE_URL" pnpm run push
