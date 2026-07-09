# Project Lind Frontend

This is the React/Vite frontend for Project Lind. It provides the clinical-trials explorer, trial detail workflow, reviewer watchlist, and Hybrid Q&A page.

## Routes

- `/` - paginated trial explorer with search and filters
- `/trial/:nctId` - trial detail, notes, tags, and watchlist controls
- `/watchlist` - saved reviewer watchlist
- `/ask` - Hybrid Q&A over the generated AI corpus

## Development

Install dependencies from the repository root or this directory:

```bash
npm --prefix frontend install
```

Run the frontend dev server:

```bash
npm --prefix frontend run dev
```

The frontend API client defaults to `/api`. For split local dev servers, point it at the backend:

```bash
VITE_API_BASE_URL=http://localhost:5001/api npm --prefix frontend run dev
```

## Build

```bash
npm --prefix frontend run build
```

The production build is written to `frontend/dist` and served by the Express backend when running `npm start` from the repository root.

## Lint

```bash
npm --prefix frontend run lint
```
