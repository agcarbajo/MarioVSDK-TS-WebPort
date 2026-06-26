# MvDK: Tipping Stars — Community Server

A small, **dependency-free** (Node.js built-ins only) backend that powers the
online community features of the [MvDK: Tipping Stars web port](https://github.com/agcarbajo/MarioVSDK-TS-WebPort):

- **User profiles** — a stand-in for the game's old Miiverse profile (name + avatar).
- **Level sharing** — upload your levels and download other players'.
- **Stars & comments** — rate and discuss levels.
- **Admin web panel** — moderate users, levels and comments (hide / delete / ban).

> This is an independent repository from the game client. Each game client can
> point at one of these servers (configured in the game's **Settings → Server**),
> so a group of players sharing the same server URL share a community.

## Run it

Requires **Node.js 18+** (no `npm install` needed — zero dependencies):

```bash
node server.js
```

Environment variables (all optional):

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `8080` | Port to listen on |
| `HOST` | `0.0.0.0` | Bind address |
| `SERVER_NAME` | `MvDK Community Server` | Shown to clients on connect |
| `ADMIN_TOKEN` | *(generated)* | Token for the admin panel |

On first run an admin token is generated and printed to the console (also saved
to `data/admin-token.txt`).

- **Admin panel:** <http://localhost:8080/admin> (paste the admin token to log in)
- All data lives under `./data/` (gitignored): `db.json`, uploaded `levels/`, `avatars/`.

To let other machines connect, run it on a reachable host/port (or behind a
reverse proxy) and give players the URL `http://<host>:<port>`.

## API (summary)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/info` | — | Server name/version (used by the client's "connect" check) |
| POST | `/api/users` | — | Create a profile `{name, avatar?}` → `{id, token}` |
| GET | `/api/users/:id` | — | Public profile |
| PUT | `/api/users/me` | user | Update own name/avatar |
| POST | `/api/levels` | user | Upload `{title, data, thumbnail?}` |
| GET | `/api/levels` | — | List (`?sort=new\|stars\|downloads`, `?author=`, paging) |
| GET | `/api/levels/:id` | — | Level + data (download) |
| POST | `/api/levels/:id/star` | user | Toggle a star |
| GET/POST | `/api/levels/:id/comments` | —/user | List / add comments |
| `*` | `/api/admin/*` | admin | Moderation (see admin panel) |

User auth is a bearer token returned at profile creation
(`Authorization: Bearer <token>`); admin auth is the `X-Admin-Token` header.

## Status

First version: profiles, level upload/download, stars, comments and the admin
panel are functional. The game client currently wires up **profile creation and
server connection**; in-game browsing/upload UI is being integrated
incrementally on top of this API.
