# Workouts

A mobile-first workout tracker that runs entirely in the browser. Plan repeating programmes, log workouts with weights, times, counts and notes, and run rest and interval timers. Installable as a PWA and works offline. There is no backend: data stays in the browser's local storage, with JSON export and import for backups (import also reads older JSON5 backups).

Built with Svelte 5 and Vite.

## Running

Everything runs in a container, so only Docker is needed:

```sh
docker compose up                                  # dev server on http://localhost:5073
docker compose run --rm app npm test               # unit tests
docker compose run --rm app npm run check          # type and lint check
docker compose run --rm app npm run build          # production build in dist/
```

The build is a static site and can be served from any static host.

## Note

The code in this repository was written by Claude.
